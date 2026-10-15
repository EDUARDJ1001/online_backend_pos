import { companiesService } from "./companies.service";

/** Agrega las marcas del pie de la empresa a un documento antes de generarlo. */
export async function withDocumentBranding<T extends { company: { footerBrands: string | null } }>(companyId: number, detail: T): Promise<T> {
  const { footerBrands } = await companiesService.documentBranding(companyId);
  return { ...detail, company: { ...detail.company, footerBrands } };
}
