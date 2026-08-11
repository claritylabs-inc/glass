"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2 } from "lucide-react";

import { OperatorSidebar } from "@/app/operator/operator-sidebar";
import { AppShell } from "@/components/app-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { ThemeModeSelector } from "@/components/ui/theme-mode-selector";
import { api } from "@/convex/_generated/api";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type OperatorCurrent = FunctionReturnType<typeof api.operator.current>;

function OperatorProfileShell({
  actions,
  children,
}: {
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <AppShell
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active="profile"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
      showBrokerShare={false}
      actions={actions}
    >
      {children}
    </AppShell>
  );
}

function OperatorProfileContent({ current }: { current: OperatorCurrent }) {
  const updateProfile = useMutation(api.users.updateProfile);
  const [name, setName] = useState(current.user.name ?? "");
  const email = current.user.email ?? current.profile.email;
  const accessLevel = current.profile.role === "owner" ? "Owner" : "Operator";

  const saveProfile = useCallback(
    async ({ name: nextName }: { name: string }) => {
      await updateProfile({ name: nextName });
    },
    [updateProfile],
  );
  const profileAutoSave = useLocalFirstAutoSave({
    mutationName: `operator.profile.${current.user._id}`,
    args: { name: name.trim() },
    valueKey: name.trim(),
    autoSave: false,
    flush: saveProfile,
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Your profile could not be saved."),
  });

  return (
    <OperatorProfileShell
      actions={<AutoSaveStatus status={profileAutoSave.status} />}
    >
      <div className="w-full">
        <FadeIn when={true} staggerIndex={1} duration={0.4}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void profileAutoSave.saveNow();
            }}
          >
            <OperationalPanel>
              <OperationalPanelHeader title="Account" />
              <OperationalPanelBody className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="operator-profile-name" className="mb-1.5">
                    Name
                  </Label>
                  <Input
                    id="operator-profile-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() => void profileAutoSave.saveNow()}
                    placeholder="Your name"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <Label htmlFor="operator-profile-email" className="mb-1.5">
                    Email
                  </Label>
                  <Input
                    id="operator-profile-email"
                    type="email"
                    value={email}
                    disabled
                  />
                </div>
                <div>
                  <Label htmlFor="operator-profile-access" className="mb-1.5">
                    Access level
                  </Label>
                  <Input
                    id="operator-profile-access"
                    value={accessLevel}
                    disabled
                  />
                </div>
              </OperationalPanelBody>
            </OperationalPanel>
          </form>
        </FadeIn>

        <FadeIn when={true} staggerIndex={2} duration={0.4}>
          <OperationalPanel className="mt-4">
            <OperationalPanelHeader title="Appearance" />
            <OperationalPanelBody>
              <ThemeModeSelector className="max-w-lg" />
            </OperationalPanelBody>
          </OperationalPanel>
        </FadeIn>
      </div>
    </OperatorProfileShell>
  );
}

export default function OperatorProfilePage() {
  const current = useCachedOperatorCurrent();

  if (!current) {
    return (
      <OperatorProfileShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </OperatorProfileShell>
    );
  }

  return <OperatorProfileContent key={current.user._id} current={current} />;
}
