"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReviews = getReviews;
exports.generateDraftResponse = generateDraftResponse;
exports.saveReviewResponse = saveReviewResponse;
const client_1 = __importDefault(require("../db/client"));
const logger_1 = require("../utils/logger");
/**
 * Get recent reviews for a location.
 * Returns actual reviews from DB, or placeholder data if none exist.
 */
async function getReviews(locationId) {
    const reviews = await client_1.default.review.findMany({
        where: { locationId },
        orderBy: { createdAt: 'desc' },
        take: 50,
    });
    if (reviews.length > 0)
        return reviews;
    // Return placeholder data when no real reviews exist
    return [
        {
            id: 'placeholder-1',
            locationId,
            platform: 'google',
            rating: 5,
            reviewerName: 'Sarah M.',
            reviewText: 'Amazing food and great atmosphere! The pasta was perfectly cooked and the staff was very friendly.',
            responseText: null,
            respondedAt: null,
            createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
            id: 'placeholder-2',
            locationId,
            platform: 'yelp',
            rating: 3,
            reviewerName: 'Mike T.',
            reviewText: 'Food was decent but the wait time was too long. Took 45 minutes to get our entrees.',
            responseText: null,
            respondedAt: null,
            createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
            id: 'placeholder-3',
            locationId,
            platform: 'google',
            rating: 4,
            reviewerName: 'Lisa K.',
            reviewText: 'Love the new menu items! The salmon was excellent. Only wish the portions were a bit larger for the price.',
            responseText: null,
            respondedAt: null,
            createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
            id: 'placeholder-4',
            locationId,
            platform: 'yelp',
            rating: 1,
            reviewerName: 'Dave R.',
            reviewText: 'Very disappointing experience. Cold food, rude server, and they got our order wrong twice.',
            responseText: null,
            respondedAt: null,
            createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
        },
        {
            id: 'placeholder-5',
            locationId,
            platform: 'tripadvisor',
            rating: 5,
            reviewerName: 'Emma W.',
            reviewText: 'Best brunch spot in town! The eggs benedict was divine and the mimosas were bottomless. Will definitely be back!',
            responseText: null,
            respondedAt: null,
            createdAt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
        },
    ];
}
/**
 * Generate a draft response to a review based on rating and content.
 */
function generateDraftResponse(input) {
    const { rating, reviewText, customerName } = input;
    const firstName = customerName.split(' ')[0] || 'there';
    const lowerText = reviewText.toLowerCase();
    // Detect themes in the review
    const mentionsFood = /food|meal|dish|menu|taste|flavor|cook|delicious|bland|cold/i.test(reviewText);
    const mentionsService = /service|staff|server|waiter|waitress|rude|friendly|attentive|slow/i.test(reviewText);
    const mentionsWait = /wait|slow|long time|took forever|minutes|hour/i.test(reviewText);
    const mentionsPrice = /price|expensive|value|worth|portion|cost|cheap/i.test(reviewText);
    const mentionsAtmosphere = /atmosphere|ambiance|decor|vibe|clean|noise|loud/i.test(reviewText);
    if (rating >= 4) {
        // Positive response
        let response = `Hi ${firstName}, thank you so much for your wonderful review! `;
        if (rating === 5) {
            response += `We're thrilled to hear you had such an amazing experience. `;
        }
        else {
            response += `We're so glad you enjoyed your visit. `;
        }
        if (mentionsFood) {
            response += `Our kitchen team takes great pride in every dish, and it means a lot to know you appreciated the food. `;
        }
        if (mentionsService) {
            response += `We'll be sure to pass along your kind words to our staff — they'll be delighted! `;
        }
        if (mentionsAtmosphere) {
            response += `We've worked hard to create a welcoming atmosphere, so we're glad it resonated with you. `;
        }
        response += `We look forward to welcoming you back soon!`;
        return response;
    }
    if (rating === 3) {
        // Mixed response
        let response = `Hi ${firstName}, thank you for taking the time to share your feedback. We appreciate your honest review. `;
        if (mentionsWait) {
            response += `We sincerely apologize for the longer-than-usual wait time. We're actively working to improve our kitchen efficiency and service speed. `;
        }
        if (mentionsFood && lowerText.includes('decent')) {
            response += `We're glad the food was satisfactory, but we always aim for excellence. `;
        }
        if (mentionsPrice) {
            response += `We continuously review our pricing to ensure great value for our guests. `;
        }
        response += `We'd love the chance to provide you with a better experience next time. Please don't hesitate to ask for a manager during your visit so we can make sure everything is perfect.`;
        return response;
    }
    // Negative response (1-2 stars)
    let response = `Hi ${firstName}, we're truly sorry to hear about your experience. This is not the standard we hold ourselves to. `;
    if (mentionsFood) {
        response += `The quality of our food is our top priority, and we're addressing this with our kitchen team immediately. `;
    }
    if (mentionsService) {
        response += `We expect nothing but professionalism and courtesy from our staff, and we'll be reviewing this matter. `;
    }
    if (mentionsWait) {
        response += `Long wait times are unacceptable, and we're taking steps to ensure this doesn't happen again. `;
    }
    if (mentionsPrice) {
        response += `We strive to offer great value and will review the concerns you've raised. `;
    }
    response += `We would very much appreciate the opportunity to make this right. Please reach out to us directly so we can address your concerns personally.`;
    return response;
}
/**
 * Save a response to a review.
 */
async function saveReviewResponse(reviewId, responseText) {
    try {
        return await client_1.default.review.update({
            where: { id: reviewId },
            data: { responseText, respondedAt: new Date() },
        });
    }
    catch (err) {
        logger_1.logger.warn('Reviews', `Could not save response for review ${reviewId}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
//# sourceMappingURL=reviews.js.map