import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { fetchThings, createThing, deleteThing } from "@/features/things/thingsSlice";
import { clearAuth } from "@/features/auth/authSlice";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/shared/components/ui/card";

export function DashboardPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { items, status } = useSelector((s) => s.things);
  const user = useSelector((s) => s.auth.user);
  const [title, setTitle] = useState("");

  useEffect(() => {
    dispatch(fetchThings());
  }, [dispatch]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!title.trim()) return;
    await dispatch(createThing({ title: title.trim() }));
    setTitle("");
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Things</h1>
          <p className="text-sm text-muted-foreground">
            {user?.email ? `Signed in as ${user.email}` : "Your items"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Only rendered for admins; the server still enforces access. */}
          {user?.is_superuser && (
            <Button variant="outline" size="sm" onClick={() => navigate("/admin")}>
              Admin
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => dispatch(clearAuth())}>
            Sign out
          </Button>
        </div>
      </header>

      <form onSubmit={handleAdd} className="mb-6 flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a thing..."
        />
        <Button type="submit">Add</Button>
      </form>

      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No things yet. Add your first one above.
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((thing) => (
            <li key={thing.id}>
              <Card>
                <CardHeader className="flex-row items-center justify-between p-4">
                  <CardTitle className="text-base">{thing.title}</CardTitle>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => dispatch(deleteThing(thing.id))}
                  >
                    Delete
                  </Button>
                </CardHeader>
                {thing.notes && (
                  <CardFooter className="p-4 pt-0 text-sm text-muted-foreground">
                    {thing.notes}
                  </CardFooter>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
