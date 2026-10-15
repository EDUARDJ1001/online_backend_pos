import type { Request, Response } from "express";

import { companiesService } from "../companies/companies.service";
import { authService } from "./auth.service";

export class AuthController {
  async login(req: Request, res: Response) {
    const result = await authService.login(req.body.username, req.body.password);

    res.json({
      message: "Inicio de sesión exitoso.",
      ...result
    });
  }

  async refresh(req: Request, res: Response) {
    const result = await authService.refresh(req.body.refreshToken);

    res.json({
      message: "Sesión renovada correctamente.",
      ...result
    });
  }

  async me(req: Request, res: Response) {
    const result = await authService.me(req.auth!.sub);
    const rawCompanyId = req.headers["x-company-id"];
    const companyId = Number(Array.isArray(rawCompanyId) ? rawCompanyId[0] : rawCompanyId);

    let activeCompany = null;
    if (Number.isInteger(companyId) && companyId > 0) {
      try {
        activeCompany = await companiesService.assertUserCompanyAccess(req.auth!.sub, companyId);
      } catch {
        activeCompany = null;
      }
    }

    res.json({
      ...result,
      activeCompany
    });
  }
}

export const authController = new AuthController();
