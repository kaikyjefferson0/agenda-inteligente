// Shared by the public booking (UC10, UC11), the customer link (UC12 to UC14)
// and the team agenda (UC15 to UC18), D66.
export { ChoiceList, type Choice } from './components/ChoiceList'
export { ContinueButton } from './components/ContinueButton'
export { CopyLinkButton } from './components/CopyLinkButton'
export { DateTimePicker, type Slot } from './components/DateTimePicker'
export { DayStrip, type DayStripHandle } from './components/DayStrip'
export { StatusBadge } from './components/StatusBadge'
export {
  CUSTOMER_MESSAGES,
  customerEmail,
  customerFieldOf,
  customerName,
  customerPhone,
  optionalEmail,
  optionalPhone,
  SERVER_FIELD_MESSAGES,
  toE164,
  type CustomerField,
} from './customer-rules'
export { ANY_PROFESSIONAL, isBookable, professionalsOf } from './professionals'
export { STATUS_LABELS, type AppointmentStatus } from './status'
export {
  availabilityQuery,
  businessQuery,
  isNotFound,
  schedulingKeys,
  type Availability,
  type AvailabilityParams,
  type PublicBusiness,
  type PublicProfessional,
  type PublicService,
} from './queries'
