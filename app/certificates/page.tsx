"use client";

import Link from "next/link";
import { BadgeCheck, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { CertificateActivityList } from "@/app/policies/[id]/policy-certificates-tab";
import dayjs from "dayjs";

function formatIssuedAt(value: unknown) {
  const numeric = Number(value ?? 0);
  return numeric ? dayjs(numeric).format("MMM D, YYYY") : "—";
}

function rowText(row: Record<string, unknown>) {
  const policy = row.policy as Record<string, unknown> | undefined;
  return [
    row.certificateHolderName,
    row.holderName,
    row.certificateHolder,
    row.reasonMessage,
    policy?.displayName,
    policy?.policyNumber,
    policy?.insuredName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function CertificatesWorkspacePage() {
  const [query, setQuery] = useState("");
  const rows = useCachedQuery(
    "certificates.listWorkspace",
    api.certificates.listWorkspace,
    {},
  ) as Array<Record<string, unknown>> | undefined;

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows ?? [];
    return (rows ?? []).filter((row) => rowText(row).includes(needle));
  }, [query, rows]);

  return (
    <AppShell
      breadcrumbDetail="Certificates"
      actions={
        <Link
          href="/policies"
          className="inline-flex h-8 items-center rounded-md border border-foreground/10 px-3 text-base font-medium text-foreground hover:bg-foreground/5"
        >
          Generate from policy
        </Link>
      }
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Certificates
            </h1>
            <p className="mt-1 text-base text-muted-foreground">
              Dense operational view of issued certificate versions and held
              certificate requests.
            </p>
          </div>
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search holder, policy, insured"
              className="pl-8"
            />
          </div>
        </div>

        {rows === undefined ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <OperationalPanel as="div" className="px-4 py-10 text-center">
            <BadgeCheck className="mx-auto mb-3 size-5 text-muted-foreground/50" />
            <p className="text-base font-medium text-foreground">
              No certificates found
            </p>
            <p className="mt-1 text-label text-muted-foreground">
              Generate a certificate from a policy to populate this workspace.
            </p>
          </OperationalPanel>
        ) : (
          <>
            <OperationalPanel as="div" className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Holder</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead>Insured</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Issued / held</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) => {
                    const policy = row.policy as
                      | Record<string, unknown>
                      | undefined;
                    const holder = String(
                      row.certificateHolderName ??
                        row.holderName ??
                        "Certificate holder",
                    );
                    return (
                      <TableRow key={String(row._id)}>
                        <TableCell className="max-w-[280px] whitespace-normal">
                          <div className="font-medium text-foreground">
                            {holder}
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-label text-muted-foreground">
                            {String(
                              row.certificateHolder ?? row.reasonMessage ?? "—",
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {policy ? (
                            <Link
                              href={`/policies/${String(policy._id)}?tab=certificates`}
                              className="font-medium text-primary hover:underline"
                            >
                              {String(policy.displayName ?? "Policy")}
                            </Link>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell>
                          {String(policy?.insuredName ?? "—")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {row.activityType === "hold"
                              ? "held"
                              : row.authorityType === "certified"
                                ? "certified"
                                : "non-binding"}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatIssuedAt(row.createdAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </OperationalPanel>

            <div className="lg:hidden">
              <CertificateActivityList rows={filteredRows} showPolicyColumn />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
