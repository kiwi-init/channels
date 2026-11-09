const PURCHASE_LINK = /,?\s*or get more at\s*\S+|\s*https?:\/\/[a-z.]*stripe\.com\/\S*/gi;

export const withoutPurchaseLinks = (why: string): string => why.replace(PURCHASE_LINK, "");
