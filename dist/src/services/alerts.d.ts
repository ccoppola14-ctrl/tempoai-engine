/**
 * Run all alert checks for a location.
 */
export declare function evaluateAlerts(locationId: string): Promise<void>;
/**
 * Run alert checks for all active locations.
 */
export declare function evaluateAllAlerts(): Promise<void>;
/**
 * Get active (unacknowledged) alerts for a location.
 */
export declare function getActiveAlerts(locationId: string): Promise<{
    locationId: string;
    id: string;
    createdAt: Date;
    data: string;
    type: string;
    message: string;
    severity: string;
    title: string;
    acknowledgedAt: Date | null;
}[]>;
/**
 * Acknowledge (dismiss) an alert.
 */
export declare function acknowledgeAlert(alertId: string): Promise<{
    locationId: string;
    id: string;
    createdAt: Date;
    data: string;
    type: string;
    message: string;
    severity: string;
    title: string;
    acknowledgedAt: Date | null;
}>;
//# sourceMappingURL=alerts.d.ts.map