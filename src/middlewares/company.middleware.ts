import type { NextFunction, Request, Response } from "express";

import { companiesService } from "../modules/companies/companies.service";
import { AppError } from "../utils/http-error";

export async function requireActiveCompany(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    return next(new AppError("No autorizado.", 401));
  }

  const rawCompanyId = req.headers["x-company-id"];
  const companyId = Number(Array.isArray(rawCompanyId) ? rawCompanyId[0] : rawCompanyId);

  if (!Number.isInteger(companyId) || companyId <= 0) {
    return next(new AppError("Debes seleccionar una empresa activa.", 400, { code: "COMPANY_REQUIRED" }));
  }

  try {
    req.activeCompany = await companiesService.assertUserCompanyAccess(req.auth.sub, companyId);
    next();
  } catch (error) {
    next(error);
  }
}
