import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { fetchUsers, resetPassword, setAdmin } from "@/features/admin/adminSlice";
import { CopyField } from "@/shared/components/CopyField";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Dialog, DialogFooter } from "@/shared/components/ui/dialog";
import { Select } from "@/shared/components/ui/select";
import { notify } from "@/shared/notificationSlice";

function Badge({ children, tone = "default" }) {
  const tones = {
    default: "bg-secondary text-secondary-foreground",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A user's password cell: "Must change" while they hold a temporary password,
 * and Reset (a second tap confirms) for anyone but yourself.
 */
function PasswordCell({ user, isMe, onReset }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function reset() {
    if (!confirming) return setConfirming(true);
    setBusy(true);
    await onReset(user);
    setBusy(false);
    setConfirming(false);
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {user.must_change_password && <Badge tone="muted">Must change</Badge>}
      {!isMe && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={reset}
          aria-label={confirming ? `Confirm resetting ${user.email}’s password` : `Reset ${user.email}’s password`}
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" />
          {confirming ? "Confirm reset" : "Reset"}
        </Button>
      )}
    </div>
  );
}

/**
 * A user's role in the app: Admin or User, changed here (asking first).
 * Your own row is a badge: another admin changes it, so nobody removes the
 * last admin by accident (the server refuses that too).
 */
function RoleCell({ user, isMe, onChange }) {
  if (isMe) {
    return (
      <span className="flex items-center gap-2">
        <Badge>{user.is_superuser ? "Admin" : "User"}</Badge>
        <span className="text-xs text-muted-foreground">You</span>
      </span>
    );
  }
  return (
    <Select
      aria-label={`Role for ${user.email}`}
      value={user.is_superuser ? "admin" : "user"}
      onChange={(e) => onChange(user, e.target.value === "admin")}
      className="h-9 w-28"
    >
      <option value="user">User</option>
      <option value="admin">Admin</option>
    </Select>
  );
}

export function AdminUsersPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { users, status } = useSelector((s) => s.admin);
  const me = useSelector((s) => s.auth.user);
  const [issued, setIssued] = useState(null); // { email, temporaryPassword }
  // The role change waiting for "Make … an admin?": { user, admin } or null.
  const [changing, setChanging] = useState(null);
  const [roleBusy, setRoleBusy] = useState(false);

  async function confirmRole() {
    setRoleBusy(true);
    const result = await dispatch(setAdmin({ userId: changing.user.id, admin: changing.admin }));
    setRoleBusy(false);
    if (setAdmin.fulfilled.match(result)) {
      const { email } = changing.user;
      dispatch(notify({ type: "success", message: changing.admin ? `${email} is an admin` : `${email} is a user` }));
    } else {
      dispatch(notify({ type: "error", message: result.payload?.message ?? "Couldn’t change their role" }));
    }
    setChanging(null);
  }

  async function handleReset(user) {
    const result = await dispatch(resetPassword(user.id));
    if (resetPassword.fulfilled.match(result)) {
      setIssued({ email: user.email, temporaryPassword: result.payload.temporaryPassword });
    }
  }

  useEffect(() => {
    dispatch(fetchUsers());
  }, [dispatch]);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">All accounts in the system</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/")}>
          Back
        </Button>
      </header>

      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No users found.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Email</th>
                <th className="p-3 font-medium">Role</th>
                <th className="p-3 font-medium">Password</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Verified</th>
                <th className="p-3 font-medium">Timezone</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="p-3">{u.name || "—"}</td>
                  <td className="p-3">{u.email}</td>
                  {/* Role before Password: on a phone it's on screen without scrolling the table. */}
                  <td className="p-3">
                    <RoleCell user={u} isMe={u.id === me?.id} onChange={(user, admin) => setChanging({ user, admin })} />
                  </td>
                  <td className="p-3">
                    <PasswordCell user={u} isMe={u.id === me?.id} onReset={handleReset} />
                  </td>
                  <td className="p-3">
                    <Badge tone={u.is_active ? "default" : "muted"}>
                      {u.is_active ? "Active" : "Disabled"}
                    </Badge>
                  </td>
                  <td className="p-3">{u.is_verified ? "Yes" : "No"}</td>
                  <td className="p-3">{u.timezone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog
        open={changing !== null}
        onClose={() => !roleBusy && setChanging(null)}
        title={changing?.admin ? "Make them an admin?" : "Make them a user?"}
        description={
          changing
            ? changing.admin
              ? `${changing.user.email} will be able to invite people, reset passwords and change who’s an admin.`
              : `${changing.user.email} will no longer have the Admin page.`
            : undefined
        }
      >
        <DialogFooter>
          <Button variant="outline" onClick={() => setChanging(null)} disabled={roleBusy}>
            Cancel
          </Button>
          <Button onClick={confirmRole} disabled={roleBusy}>
            {roleBusy ? "Saving…" : changing?.admin ? "Make admin" : "Make user"}
          </Button>
        </DialogFooter>
      </Dialog>
      <Dialog
        open={issued !== null}
        onClose={() => setIssued(null)}
        title="Password reset"
        description={
          issued
            ? `Send ${issued.email} this temporary password. They choose their own when they sign in, and any phone still signed in is locked until then. It won’t be shown again.`
            : undefined
        }
      >
        {issued && (
          <div className="flex flex-col gap-4">
            <CopyField value={issued.temporaryPassword} label="Copy temporary password" />
            <DialogFooter>
              <Button onClick={() => setIssued(null)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </Dialog>
    </div>
  );
}
