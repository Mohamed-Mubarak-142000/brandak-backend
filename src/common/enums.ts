export enum Role {
  CUSTOMER = 'CUSTOMER',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

/**
 * What kind of business a store is. The marketplace is not only brands: showrooms, warehouses
 * and shops sell here too. Stores created before this existed are treated as BRAND.
 */
export enum StoreType {
  BRAND = 'BRAND',
  SHOWROOM = 'SHOWROOM',
  WAREHOUSE = 'WAREHOUSE',
  SHOP = 'SHOP',
}

/** Review state only. Being visible to customers also needs a running subscription. */
export enum BrandStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  ACTIVE = 'ACTIVE',
  REJECTED = 'REJECTED',
  SUSPENDED = 'SUSPENDED',
}

export enum BrandMemberRole {
  OWNER = 'OWNER',
}

export enum BillingPeriod {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum SubscriptionStatus {
  PENDING_PAYMENT = 'PENDING_PAYMENT',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentMethod {
  INSTAPAY_MANUAL = 'INSTAPAY_MANUAL',
}

export enum PaymentStatus {
  AWAITING_PROOF = 'AWAITING_PROOF',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum FilePurpose {
  PRODUCT_IMAGE = 'PRODUCT_IMAGE',
  BRAND_LOGO = 'BRAND_LOGO',
  BRAND_COVER = 'BRAND_COVER',
  PAYMENT_PROOF = 'PAYMENT_PROOF',
  /** Customer photos on a review (public). */
  REVIEW_IMAGE = 'REVIEW_IMAGE',
  /** Photos attached to a return request or a support ticket. */
  CLAIM_IMAGE = 'CLAIM_IMAGE',
}

export enum FileVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

export enum ProductStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

export enum OrderStatus {
  /** Waiting for the customer to confirm with an email code (new or low-trust customers). */
  AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION',
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PROCESSING = 'PROCESSING',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  /** The customer refused the parcel at the door. */
  REFUSED = 'REFUSED',
}

export enum OrderPaymentMethod {
  COD = 'COD',
}

export enum ReviewStatus {
  VISIBLE = 'VISIBLE',
  HIDDEN = 'HIDDEN',
}

export enum ReportTarget {
  REVIEW = 'REVIEW',
  PRODUCT = 'PRODUCT',
  BRAND = 'BRAND',
}

export enum ReportStatus {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
  DISMISSED = 'DISMISSED',
}

export enum OtpPurpose {
  VERIFY_CONTACT = 'VERIFY_CONTACT',
  RESET_PASSWORD = 'RESET_PASSWORD',
  CONFIRM_ORDER = 'CONFIRM_ORDER',
}
