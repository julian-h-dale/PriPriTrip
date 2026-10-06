import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { KeyRound } from "lucide-react";
import { ChangePasswordForm } from "@/features/auth/ChangePasswordForm";
import { heldSignInPassword, signOut } from "@/features/auth/authSlice";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";

/**
 * In place of the whole app while the account holds a temporary password
 * (after an admin's invite or reset): choose your own, or sign out. The
 * server refuses everything else meanwhile, so there's nothing to show.
 * Straight after signing in, the temporary password isn't asked for again.
 */
export function ForcedPasswordChange() {
  const dispatch = useDispatch();
  const email = useSelector((s) => s.auth.user?.email);
  const [temporary] = useState(heldSignInPassword);
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-env(safe-area-inset-top))] w-full max-w-md flex-col justify-center gap-4 px-4 py-8">
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">Choose a new password</h1>
            <p className="text-sm text-muted-foreground">
              {email ? `${email} has` : "This account has"} a temporary password. Pick your own to carry on.
            </p>
          </div>
        </div>
        <ChangePasswordForm knownCurrent={temporary} currentLabel="Temporary password" submitLabel="Save password" />
      </Card>
      <Button variant="ghost" className="self-center" onClick={() => dispatch(signOut())}>
        Sign out
      </Button>
    </main>
  );
}
