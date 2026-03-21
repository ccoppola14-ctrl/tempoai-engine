interface DraftResponseInput {
    rating: number;
    reviewText: string;
    customerName: string;
}
/**
 * Get recent reviews for a location.
 * Returns actual reviews from DB, or placeholder data if none exist.
 */
export declare function getReviews(locationId: string): Promise<{
    locationId: string;
    id: string;
    createdAt: Date;
    platform: string;
    rating: number;
    reviewerName: string;
    reviewText: string;
    responseText: string | null;
    respondedAt: Date | null;
}[] | {
    id: string;
    locationId: string;
    platform: string;
    rating: number;
    reviewerName: string;
    reviewText: string;
    responseText: null;
    respondedAt: null;
    createdAt: string;
}[]>;
/**
 * Generate a draft response to a review based on rating and content.
 */
export declare function generateDraftResponse(input: DraftResponseInput): string;
/**
 * Save a response to a review.
 */
export declare function saveReviewResponse(reviewId: string, responseText: string): Promise<{
    locationId: string;
    id: string;
    createdAt: Date;
    platform: string;
    rating: number;
    reviewerName: string;
    reviewText: string;
    responseText: string | null;
    respondedAt: Date | null;
} | null>;
export {};
//# sourceMappingURL=reviews.d.ts.map