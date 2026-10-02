import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { fetchUsers } from "@/features/admin/adminSlice";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";

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

export function AdminUsersPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { users, status } = useSelector((s) => s.admin);

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
                  <td className="p-3">
                    <Badge tone={u.is_superuser ? "default" : "muted"}>
                      {u.is_superuser ? "Admin" : "User"}
                    </Badge>
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
    </div>
  );
}
