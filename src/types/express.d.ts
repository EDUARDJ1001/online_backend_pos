import type { AuthUserPayload } from "../utils/auth-tokens";
import type { CompanySummary } from "../modules/companies/companies.service";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUserPayload;
      activeCompany?: CompanySummary;
    }
  }
}

export {};
