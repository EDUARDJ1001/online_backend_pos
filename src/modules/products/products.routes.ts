import { Router } from "express";

import { requirePermission } from "../../middlewares/require-permission";
import { validateRequest } from "../../middlewares/validate-request";
import { asyncHandler } from "../../utils/async-handler";
import {
  createProductCategorySchema,
  createProductWithStockSchema,
  listProductCategoriesSchema,
  listProductsSchema,
  productCategoryIdSchema,
  productIdSchema,
  updateProductCategorySchema,
  updateProductCategoryStatusSchema,
  updateProductSchema,
  updateProductStatusSchema
} from "./products.schemas";
import { productsController } from "./products.controller";
import { activeOnlyUnlessAdmin, requireDeactivationRole } from "../../middlewares/deactivation.middleware";

export const productsRouter = Router();

productsRouter.get(
  "/categories",
  requirePermission("categories.view"),
  validateRequest(listProductCategoriesSchema, "query"),
  activeOnlyUnlessAdmin,
  asyncHandler(productsController.listCategories.bind(productsController))
);
productsRouter.post(
  "/categories",
  requirePermission("categories.create"),
  validateRequest(createProductCategorySchema),
  asyncHandler(productsController.createCategory.bind(productsController))
);
productsRouter.put(
  "/categories/:id",
  requirePermission("categories.edit"),
  validateRequest(productCategoryIdSchema, "params"),
  validateRequest(updateProductCategorySchema),
  asyncHandler(productsController.updateCategory.bind(productsController))
);
productsRouter.patch(
  "/categories/:id/status",
  requirePermission("categories.edit"),
  requireDeactivationRole,
  validateRequest(productCategoryIdSchema, "params"),
  validateRequest(updateProductCategoryStatusSchema),
  asyncHandler(productsController.updateCategoryStatus.bind(productsController))
);

productsRouter.get("/", requirePermission("products.view"), validateRequest(listProductsSchema, "query"), activeOnlyUnlessAdmin, asyncHandler(productsController.list.bind(productsController)));
productsRouter.get("/next-code", requirePermission("products.view"), asyncHandler(productsController.nextCode.bind(productsController)));
productsRouter.post("/", requirePermission("products.create"), validateRequest(createProductWithStockSchema), asyncHandler(productsController.create.bind(productsController)));
productsRouter.get("/:id", requirePermission("products.view"), validateRequest(productIdSchema, "params"), asyncHandler(productsController.getById.bind(productsController)));
productsRouter.put(
  "/:id",
  requirePermission("products.edit"),
  validateRequest(productIdSchema, "params"),
  validateRequest(updateProductSchema),
  asyncHandler(productsController.update.bind(productsController))
);
productsRouter.patch(
  "/:id/status",
  requirePermission("products.edit"),
  requireDeactivationRole,
  validateRequest(productIdSchema, "params"),
  validateRequest(updateProductStatusSchema),
  asyncHandler(productsController.updateStatus.bind(productsController))
);
