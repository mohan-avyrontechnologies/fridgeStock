import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useFoodStore } from '../stores/foodStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useToastStore } from '../stores/toastStore';

const REFRESH_MS = 5 * 60 * 1000;

/**
 * Signed-in layout: a slim header, the page, and a thumb-reachable bottom nav.
 * Refreshes on focus and every few minutes so "remaining days" roll over
 * without a reload.
 */
export function AppShell() {
  const refresh = useFoodStore((s) => s.refresh);
  const fetchUnread = useNotificationStore((s) => s.fetchUnread);

  useEffect(() => {
    const tick = () => {
      void refresh();
      void fetchUnread();
    };
    tick();
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(id);
    };
  }, [refresh, fetchUnread]);

  return (
    <div className="pb-nav mx-auto min-h-dvh max-w-xl">
      <Outlet />
      <Toast />
      <BottomNav />
    </div>
  );
}

export function PageHeader({ title, subtitle, back }: { title: string; subtitle?: ReactNode; back?: string }) {
  const unread = useNotificationStore((s) => s.unread);
  return (
    <header className="top-inset sticky top-0 z-30 border-b border-line/70 bg-paper/95 backdrop-blur">
      <div className="flex min-h-14 items-center gap-2 px-4 py-2">
        {back && (
          <Link to={back} aria-label="Back" className="-ml-2 grid size-11 place-items-center rounded-full hover:bg-brand-soft">
            <svg aria-hidden viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-2">
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        </div>
        <Link
          to="/notifications"
          aria-label={unread ? `Reminders, ${unread} unread` : 'Reminders'}
          className="relative grid size-11 place-items-center rounded-full hover:bg-brand-soft"
        >
          <BellIcon />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 grid min-w-5 place-items-center rounded-full bg-past-bar px-1 text-[11px] font-bold text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Link>
      </div>
    </header>
  );
}

function BottomNav() {
  const cookFirstCount = useFoodStore((s) => s.cookFirst?.length ?? 0);
  return (
    <nav
      aria-label="Main"
      className="bottom-inset fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5 items-end px-1">
        <NavItem to="/" label="Home" icon={<HomeIcon />} end />
        <NavItem to="/cook-first" label="Cook First" icon={<PanIcon />} badge={cookFirstCount} />
        <li className="flex justify-center">
          <Link
            to="/add"
            aria-label="Add food"
            className="-mt-5 grid size-14 place-items-center rounded-full bg-brand text-white shadow-lg shadow-brand/30 hover:bg-brand-hover"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-7 fill-none stroke-current stroke-[2.5]">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </Link>
        </li>
        <NavItem to="/history" label="History" icon={<ListIcon />} />
        <NavItem to="/settings" label="Settings" icon={<GearIcon />} />
      </ul>
    </nav>
  );
}

function NavItem({
  to,
  label,
  icon,
  badge,
  end,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  end?: boolean;
}) {
  return (
    <li>
      <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
          `relative flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
            isActive ? 'text-brand' : 'text-muted'
          }`
        }
      >
        {icon}
        {label}
        {!!badge && (
          <span className="absolute top-2 left-1/2 ml-2 grid min-w-5 place-items-center rounded-full bg-today-bar px-1 text-[11px] font-bold text-white">
            {badge}
          </span>
        )}
      </NavLink>
    </li>
  );
}

function Toast() {
  const message = useToastStore((s) => s.message);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
      {message && (
        <div className="sheet-in rounded-full bg-ink px-4 py-2.5 text-sm font-medium text-white shadow-lg">{message}</div>
      )}
    </div>
  );
}

const iconClass = 'size-6 fill-none stroke-current stroke-[1.8]';

function HomeIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={iconClass}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" strokeLinejoin="round" />
    </svg>
  );
}
function PanIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={iconClass}>
      <path d="M3 11h14v1.5A5.5 5.5 0 0 1 11.5 18h-3A5.5 5.5 0 0 1 3 12.5zM17 12h4" strokeLinecap="round" />
      <path d="M8 4c-1 1.5 1 2.5 0 4M12 4c-1 1.5 1 2.5 0 4" strokeLinecap="round" />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={iconClass}>
      <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" strokeLinecap="round" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={iconClass}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}
function BellIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6 fill-none stroke-current stroke-[1.8]">
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
