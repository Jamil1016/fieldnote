import { setViewAs } from "@/app/(app)/shell-actions";
import { hasMinRole, ROLE_LABEL, VIEW_AS_ROLES, type Role } from "@/lib/auth/roles";

/** Segmented "View as" control. Plain form posts, so it works without client JS. */
export function ViewAs({ actualRole, currentRole }: { actualRole: Role; currentRole: Role }) {
  const options = VIEW_AS_ROLES.filter((r) => hasMinRole(actualRole, r));
  if (options.length < 2) return null;
  return (
    <form action={setViewAs} className="flex items-center gap-2" aria-label="Preview a role">
      <span className="hidden text-xs text-chrome-ink xl:inline">View as</span>
      <div className="flex overflow-hidden rounded-sm border border-white/20">
        {options.map((role) => {
          const selected = role === currentRole;
          return (
            <button
              key={role}
              type="submit"
              name="role"
              value={role}
              aria-pressed={selected}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                selected ? "bg-white text-chrome" : "text-chrome-ink hover:bg-white/10 hover:text-white"
              }`}
            >
              {ROLE_LABEL[role]}
            </button>
          );
        })}
      </div>
    </form>
  );
}
