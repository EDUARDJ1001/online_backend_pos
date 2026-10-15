import { Router } from "express";

import { requireRoles } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/require-permission";
import { requireActiveCompany } from "../../middlewares/company.middleware";
import { asyncHandler } from "../../utils/async-handler";
import { validateRequest } from "../../middlewares/validate-request";
import { companiesController } from "./companies.controller";
import { createCompanySchema, selectCompanySchema, updateCompanySchema } from "./companies.schemas";

export const companiesRouter = Router();

// my / select no llevan permiso: el usuario debe poder listar y elegir su empresa
// activa antes de que apliquen los permisos por empresa.
companiesRouter.get("/my", asyncHandler(companiesController.myCompanies.bind(companiesController)));
companiesRouter.post(
  "/select",
  validateRequest(selectCompanySchema),
  asyncHandler(companiesController.selectCompany.bind(companiesController))
);

// Crear empresas: solo el Super Administrador (no exige empresa activa).
companiesRouter.post(
  "/",
  requireRoles(["SUPERADMIN"]),
  validateRequest(createCompanySchema),
  asyncHandler(companiesController.create.bind(companiesController))
);

companiesRouter.get(
  "/active/footer-brands",
  requireActiveCompany,
  requirePermission("company.edit"),
  asyncHandler(companiesController.activeFooterBrands.bind(companiesController))
);

// Editar la empresa activa: exige empresa seleccionada y permiso company.edit.
companiesRouter.put(
  "/active",
  requireActiveCompany,
  requirePermission("company.edit"),
  validateRequest(updateCompanySchema),
  asyncHandler(companiesController.updateActiveCompany.bind(companiesController))
);
