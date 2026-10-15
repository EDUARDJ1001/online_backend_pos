import type { Request, Response } from "express";

import { auditService } from "../audit/audit.service";
import { parseFooterBrands } from "../invoices/invoice-assets";
import { companiesService, type CompanySummary } from "./companies.service";

/**
 * El logo/favicon pueden ser data URIs de cientos de KB. Se sustituyen por un
 * indicador antes de guardarlos en la bitácora para no inflar audit_logs.
 */
function auditView(company: CompanySummary) {
  const { logoUrl, faviconUrl, ...rest } = company;
  return { ...rest, hasLogo: Boolean(logoUrl), hasFavicon: Boolean(faviconUrl) };
}

export class CompaniesController {
  async myCompanies(req: Request, res: Response) {
    const companies = await companiesService.getUserCompanies(req.auth!.sub);

    res.json({
      items: companies
    });
  }

  async selectCompany(req: Request, res: Response) {
    const company = await companiesService.assertUserCompanyAccess(req.auth!.sub, req.body.companyId);

    res.json({
      message: "Empresa activa seleccionada correctamente.",
      item: company
    });
  }

  async create(req: Request, res: Response) {
    const company = await companiesService.createCompany(req.auth!.sub, req.body);

    await auditService.log(
      {
        companyId: company.id,
        userId: req.auth!.sub,
        entityType: "EMPRESA",
        entityId: company.id,
        action: "CREAR",
        description: `Empresa ${company.commercialName} creada.`,
        newValues: auditView(company)
      },
      req
    );

    res.status(201).json({
      message: "Empresa creada. Registra su CAI en Facturación SAR para poder facturar.",
      item: company
    });
  }

  async activeFooterBrands(req: Request, res: Response) {
    const { footerBrands } = await companiesService.documentBranding(req.activeCompany!.id);

    res.json({
      items: parseFooterBrands(footerBrands)
    });
  }

  async updateActiveCompany(req: Request, res: Response) {
    const companyId = req.activeCompany!.id;
    const { previous, current } = await companiesService.updateCompany(companyId, req.body);

    await auditService.log(
      {
        companyId,
        userId: req.auth!.sub,
        entityType: "EMPRESA",
        entityId: companyId,
        action: "ACTUALIZAR",
        description: `Datos de la empresa ${current.commercialName} actualizados.${
          req.body.footerBrands === undefined ? "" : ` Marcas del pie: ${req.body.footerBrands.length}.`
        }`,
        oldValues: auditView(previous),
        newValues: auditView(current)
      },
      req
    );

    res.json({
      message: "Datos de la empresa actualizados correctamente.",
      item: current
    });
  }
}

export const companiesController = new CompaniesController();
