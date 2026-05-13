import { redirect } from "next/navigation";

export default async function ConnectedOrgsIndexPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string | string[] }>;
}) {
  const params = searchParams ? await searchParams : {};
  const view = Array.isArray(params.view) ? params.view[0] : params.view;

  redirect(view === "clients" ? "/connect/vendors" : "/connect/clients");
}
