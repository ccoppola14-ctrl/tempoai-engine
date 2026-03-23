"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const client_1 = __importDefault(require("../db/client"));
const logger_1 = require("../utils/logger");
const router = (0, express_1.Router)();
// Lazy-init Stripe so the app boots even when keys are missing
function getStripe() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key)
        return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Stripe = require('stripe');
    return new Stripe(key);
}
function billingNotConfigured(res) {
    res.status(503).json({ error: 'Billing not configured. Stripe keys are missing.' });
}
// ─── POST /api/billing/create-checkout ────────────────────
router.post('/create-checkout', async (req, res) => {
    const stripe = getStripe();
    if (!stripe)
        return billingNotConfigured(res);
    const { plan, merchantId, email, locationCount } = req.body;
    if (!plan || !merchantId || !email || !locationCount) {
        res.status(400).json({ error: 'Missing required fields: plan, merchantId, email, locationCount' });
        return;
    }
    const validPlans = ['starter', 'growth', 'pro'];
    if (!validPlans.includes(plan)) {
        res.status(400).json({ error: 'Plan must be "starter", "growth", or "pro"' });
        return;
    }
    const priceMap = {
        starter: process.env.STRIPE_STARTER_PRICE_ID,
        growth: process.env.STRIPE_GROWTH_PRICE_ID,
        pro: process.env.STRIPE_PRO_PRICE_ID,
    };
    const priceId = priceMap[plan];
    if (!priceId) {
        res.status(503).json({ error: `Price ID not configured for ${plan} plan` });
        return;
    }
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://usetempoai.com';
    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            customer_email: email,
            subscription_data: {
                trial_period_days: 14,
                metadata: { merchantId, plan },
            },
            line_items: [{
                    price: priceId,
                    quantity: locationCount,
                }],
            metadata: { merchantId, plan },
            success_url: `${process.env.ENGINE_URL || 'https://api.usetempoai.com'}/api/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${dashboardUrl}/subscribe`,
        });
        logger_1.logger.info('Billing', `Checkout session created for merchant ${merchantId} (${plan})`);
        res.json({ url: session.url });
    }
    catch (err) {
        logger_1.logger.error('Billing', 'Failed to create checkout session', err);
        res.status(500).json({ error: 'Failed to create checkout session' });
    }
});
// ─── GET /api/billing/success ─────────────────────────────
router.get('/success', async (req, res) => {
    const stripe = getStripe();
    if (!stripe)
        return billingNotConfigured(res);
    const sessionId = req.query.session_id;
    if (!sessionId) {
        res.status(400).json({ error: 'Missing session_id' });
        return;
    }
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://usetempoai.com';
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['subscription'],
        });
        const merchantId = session.metadata?.merchantId;
        const plan = session.metadata?.plan;
        const customerId = session.customer;
        const subscriptionId = typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
        if (merchantId) {
            // Try SquareMerchant first, then CloverMerchant
            const square = await client_1.default.squareMerchant.findUnique({ where: { merchantId } });
            if (square) {
                await client_1.default.squareMerchant.update({
                    where: { merchantId },
                    data: {
                        stripeCustomerId: customerId,
                        stripeSubscriptionId: subscriptionId,
                        billingPlan: plan,
                        billingStatus: 'active',
                    },
                });
            }
            else {
                const clover = await client_1.default.cloverMerchant.findUnique({ where: { merchantId } });
                if (clover) {
                    await client_1.default.cloverMerchant.update({
                        where: { merchantId },
                        data: {
                            stripeCustomerId: customerId,
                            stripeSubscriptionId: subscriptionId,
                            billingPlan: plan,
                            billingStatus: 'active',
                        },
                    });
                }
            }
            logger_1.logger.info('Billing', `Subscription activated for merchant ${merchantId} (${plan})`);
        }
        res.redirect(`${dashboardUrl}/settings?tab=billing&status=success`);
    }
    catch (err) {
        logger_1.logger.error('Billing', 'Failed to verify checkout session', err);
        res.redirect(`${dashboardUrl}/settings?tab=billing&status=error`);
    }
});
// ─── POST /api/billing/webhook ────────────────────────────
router.post('/webhook', async (req, res) => {
    const stripe = getStripe();
    if (!stripe)
        return billingNotConfigured(res);
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        res.status(503).json({ error: 'Webhook secret not configured' });
        return;
    }
    let event;
    try {
        // Note: For webhook signature verification, the raw body is needed.
        // Express json() middleware parses the body, so we rely on the raw body
        // being available. In production, you'd configure express.raw() for this route.
        const rawBody = JSON.stringify(req.body);
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    }
    catch (err) {
        logger_1.logger.error('Billing', 'Webhook signature verification failed', err);
        res.status(400).json({ error: 'Invalid signature' });
        return;
    }
    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object;
                const merchantId = session.metadata?.merchantId;
                const plan = session.metadata?.plan;
                const customerId = session.customer;
                const subscriptionId = session.subscription;
                if (merchantId) {
                    await updateMerchantBilling(merchantId, {
                        stripeCustomerId: customerId,
                        stripeSubscriptionId: subscriptionId,
                        billingPlan: plan,
                        billingStatus: 'active',
                    });
                    logger_1.logger.info('Billing', `Webhook: checkout completed for ${merchantId}`);
                }
                break;
            }
            case 'customer.subscription.deleted': {
                const subscription = event.data.object;
                const merchantId = subscription.metadata?.merchantId;
                if (merchantId) {
                    await updateMerchantBilling(merchantId, {
                        billingStatus: 'cancelled',
                        stripeSubscriptionId: null,
                    });
                    logger_1.logger.info('Billing', `Webhook: subscription cancelled for ${merchantId}`);
                }
                break;
            }
            case 'invoice.payment_failed': {
                const invoice = event.data.object;
                const subscriptionId = invoice.subscription;
                if (subscriptionId) {
                    // Find merchant by subscription ID and mark as past_due
                    const square = await client_1.default.squareMerchant.findFirst({
                        where: { stripeSubscriptionId: subscriptionId },
                    });
                    if (square) {
                        await client_1.default.squareMerchant.update({
                            where: { id: square.id },
                            data: { billingStatus: 'past_due' },
                        });
                    }
                    else {
                        const clover = await client_1.default.cloverMerchant.findFirst({
                            where: { stripeSubscriptionId: subscriptionId },
                        });
                        if (clover) {
                            await client_1.default.cloverMerchant.update({
                                where: { id: clover.id },
                                data: { billingStatus: 'past_due' },
                            });
                        }
                    }
                    logger_1.logger.info('Billing', `Webhook: payment failed for subscription ${subscriptionId}`);
                }
                break;
            }
            default:
                logger_1.logger.info('Billing', `Webhook: unhandled event type ${event.type}`);
        }
    }
    catch (err) {
        logger_1.logger.error('Billing', `Webhook handler error for ${event.type}`, err);
    }
    res.json({ received: true });
});
// ─── GET /api/billing/portal ──────────────────────────────
router.get('/portal', async (req, res) => {
    const stripe = getStripe();
    if (!stripe)
        return billingNotConfigured(res);
    const merchantId = req.query.merchantId;
    if (!merchantId) {
        res.status(400).json({ error: 'Missing merchantId' });
        return;
    }
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://usetempoai.com';
    try {
        // Find the Stripe customer ID
        let customerId = null;
        const square = await client_1.default.squareMerchant.findUnique({ where: { merchantId } });
        if (square?.stripeCustomerId) {
            customerId = square.stripeCustomerId;
        }
        else {
            const clover = await client_1.default.cloverMerchant.findUnique({ where: { merchantId } });
            if (clover?.stripeCustomerId) {
                customerId = clover.stripeCustomerId;
            }
        }
        if (!customerId) {
            res.status(404).json({ error: 'No billing account found for this merchant' });
            return;
        }
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${dashboardUrl}/settings?tab=billing`,
        });
        res.json({ url: portalSession.url });
    }
    catch (err) {
        logger_1.logger.error('Billing', 'Failed to create portal session', err);
        res.status(500).json({ error: 'Failed to create portal session' });
    }
});
// ─── GET /api/billing/status ──────────────────────────────
router.get('/status', async (req, res) => {
    const merchantId = req.query.merchantId;
    if (!merchantId) {
        res.status(400).json({ error: 'Missing merchantId' });
        return;
    }
    try {
        const square = await client_1.default.squareMerchant.findUnique({ where: { merchantId } });
        if (square) {
            res.json({
                configured: !!process.env.STRIPE_SECRET_KEY,
                billingPlan: square.billingPlan,
                billingStatus: square.billingStatus,
                stripeCustomerId: square.stripeCustomerId,
            });
            return;
        }
        const clover = await client_1.default.cloverMerchant.findUnique({ where: { merchantId } });
        if (clover) {
            res.json({
                configured: !!process.env.STRIPE_SECRET_KEY,
                billingPlan: clover.billingPlan,
                billingStatus: clover.billingStatus,
                stripeCustomerId: clover.stripeCustomerId,
            });
            return;
        }
        res.json({
            configured: !!process.env.STRIPE_SECRET_KEY,
            billingPlan: null,
            billingStatus: null,
            stripeCustomerId: null,
        });
    }
    catch (err) {
        logger_1.logger.error('Billing', 'Failed to get billing status', err);
        res.status(500).json({ error: 'Failed to get billing status' });
    }
});
// Helper: update billing fields on whichever merchant model matches
async function updateMerchantBilling(merchantId, data) {
    const square = await client_1.default.squareMerchant.findUnique({ where: { merchantId } });
    if (square) {
        await client_1.default.squareMerchant.update({ where: { merchantId }, data });
        return;
    }
    const clover = await client_1.default.cloverMerchant.findUnique({ where: { merchantId } });
    if (clover) {
        await client_1.default.cloverMerchant.update({ where: { merchantId }, data });
    }
}
exports.default = router;
//# sourceMappingURL=billing.js.map