import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuthStore } from '../stores/authStore';
import { useFoodStore } from '../stores/foodStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useToastStore } from '../stores/toastStore';

const REFRESH_MS = 5 * 60 * 1000;

/**
 * Signed-in layout. Phones get a slim header and a thumb-reachable bottom nav;
 * from the `lg` breakpoint (1024px) a fixed sidebar replaces the bottom nav.
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
    <div className="min-h-dvh">
      <Sidebar />
      <div className="lg:pl-64">
        <div className="pb-nav mx-auto min-h-dvh max-w-xl lg:max-w-5xl lg:pb-12">
          <Outlet />
        </div>
      </div>
      <Toast />
      <BottomNav />
    </div>
  );
}

/**
 * Screen header. The dashboard passes `showIcons` to show the bell (with the
 * unread count) and the settings icon at every screen size; elsewhere the bell
 * shows on phones only, because the desktop sidebar has it.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  showIcons = false,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: string;
  showIcons?: boolean;
}) {
  const unread = useNotificationStore((s) => s.unread);
  return (
    <header className="top-inset sticky top-0 z-30 border-b border-line/70 bg-paper/95 backdrop-blur lg:static lg:border-0 lg:bg-transparent">
      <div className="flex min-h-14 items-center gap-2 px-4 py-2 lg:px-8 lg:pt-8 lg:pb-2">
        {back && (
          <Link
            to={back}
            aria-label="Back"
            className="-ml-2 grid size-11 place-items-center rounded-full hover:bg-brand-soft"
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-2">
              <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold tracking-tight lg:text-3xl">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted lg:mt-1 lg:text-base">{subtitle}</p>}
        </div>
        <Link
          to="/notifications"
          aria-label={unread ? `Reminders, ${unread} unread` : 'Reminders'}
          className={`relative grid size-11 place-items-center rounded-full hover:bg-brand-soft ${showIcons ? '' : 'lg:hidden'}`}
        >
          <BellIcon />
          <UnreadDot count={unread} className="absolute top-1.5 right-1.5" />
        </Link>
        {/* On phones Settings lives here (the bottom bar holds Shopping and Plan); on desktop it's in the sidebar. */}
        <Link
          to="/settings"
          aria-label="Open settings"
          className={`grid size-11 place-items-center rounded-full hover:bg-brand-soft ${showIcons ? '' : 'lg:hidden'}`}
        >
          <GearIcon />
        </Link>
      </div>
    </header>
  );
}

/** Page body with the gutters used on every signed-in screen. */
export function PageBody({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <main className={`space-y-6 px-4 pt-4 lg:px-8 lg:pt-4 ${narrow ? 'lg:max-w-2xl' : ''}`}>{children}</main>;
}

function UnreadDot({ count, className = '' }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={`grid min-w-5 place-items-center rounded-full bg-past-bar px-1 text-[11px] font-bold text-white ${className}`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}

function Sidebar() {
  const user = useAuthStore((s) => s.user);
  const unread = useNotificationStore((s) => s.unread);
  const cookFirstCount = useFoodStore((s) => s.cookFirst?.length ?? 0);

  const item = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors ${
      isActive ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-paper'
    }`;

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-card px-4 py-6 lg:flex">
      <Link to="/" className="flex min-h-11 items-center gap-2.5 px-2">
        <img src="/icon.svg" alt="" className="size-9" />
        <span className="text-lg font-bold tracking-tight">Cook First</span>
      </Link>

      <Link
        to="/add"
        className="mt-8 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-on-brand hover:bg-brand-hover"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[2.5]">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
        Add food
      </Link>

      <nav aria-label="Main" className="mt-6">
        <ul className="space-y-1">
          <li>
            <NavLink to="/" end className={item}>
              <HomeIcon /> Home
            </NavLink>
          </li>
          <li>
            <NavLink to="/cook-first" className={item}>
              <PanIcon /> <span className="flex-1">Cook First</span>
              {cookFirstCount > 0 && (
                <span className="grid min-w-6 place-items-center rounded-full bg-today-bar px-1.5 text-xs font-bold text-white">
                  {cookFirstCount}
                </span>
              )}
            </NavLink>
          </li>
          <li>
            <NavLink to="/shopping" className={item}>
              <CartIcon /> Shopping
            </NavLink>
          </li>
          <li>
            <NavLink to="/plan" className={item}>
              <CalendarIcon /> Meal plan
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/notifications"
              className={item}
              aria-label={unread ? `Reminders, ${unread} unread` : 'Reminders'}
            >
              <BellIcon /> <span className="flex-1">Reminders</span>
              <UnreadDot count={unread} className="min-w-6 px-1.5 text-xs" />
            </NavLink>
          </li>
          <li>
            <NavLink to="/household" className={item}>
              <PeopleIcon /> Household
            </NavLink>
          </li>
          <li>
            <NavLink to="/insights" className={item}>
              <ChartIcon /> Insights
            </NavLink>
          </li>
          <li>
            <NavLink to="/history" className={item}>
              <ListIcon /> History
            </NavLink>
          </li>
          <li>
            <NavLink to="/settings" className={item}>
              <GearIcon /> Settings
            </NavLink>
          </li>
        </ul>
      </nav>

      {user && (
        <div className="mt-auto border-t border-line px-2 pt-4">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
        </div>
      )}
    </aside>
  );
}

function BottomNav() {
  const cookFirstCount = useFoodStore((s) => s.cookFirst?.length ?? 0);
  return (
    <nav
      aria-label="Main"
      className="bottom-inset fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5 items-end px-1">
        <NavItem to="/" label="Home" icon={<HomeIcon />} end />
        <NavItem to="/cook-first" label="Cook First" icon={<PanIcon />} badge={cookFirstCount} />
        <li className="flex justify-center">
          <Link to="/add" className="flex flex-col items-center gap-0.5 pb-1.5 text-[11px] font-semibold text-brand">
            <span className="-mt-5 grid size-14 place-items-center rounded-full bg-brand text-on-brand shadow-lg shadow-brand/30 hover:bg-brand-hover">
              <svg aria-hidden viewBox="0 0 24 24" className="size-7 fill-none stroke-current stroke-[2.5]">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
            </span>
            Add food
          </Link>
        </li>
        <NavItem to="/shopping" label="Shopping" icon={<CartIcon />} />
        <NavItem to="/plan" label="Plan" icon={<CalendarIcon />} />
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

/** Short confirmation messages, with an optional action such as "Undo". */
function Toast() {
  const { message, action, clear } = useToastStore();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 lg:bottom-8 lg:left-64"
    >
      {message && (
        <div className="sheet-in pointer-events-auto flex items-center gap-2 rounded-full bg-ink py-1.5 pr-1.5 pl-4 text-sm font-medium text-paper shadow-lg">
          <span className="py-1">{message}</span>
          {action && (
            <button
              type="button"
              onClick={() => {
                clear();
                action.onClick();
              }}
              className="min-h-11 rounded-full px-4 font-semibold text-paper underline hover:bg-paper/10"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const iconClass = 'size-6 shrink-0 fill-none stroke-current stroke-[1.8]';

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
function PeopleIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={iconClass}>
      <circle cx="9" cy="8" r="3.5" />
      <path
        d="M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c2 .6 3.2 2.3 3.5 5.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
function ChartIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={iconClass}>
      <path d="M5 20V11M12 20V4M19 20v-6" strokeLinecap="round" />
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
    <svg aria-hidden viewBox="0 0 24 24" className={iconClass}>
      <path
        d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6 fill-none stroke-current stroke-[1.8]">
      <path
        d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.3h8.6a1.5 1.5 0 0 0 1.4-1.1L20.5 8H6.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9.5" cy="19.5" r="1.3" />
      <circle cx="17" cy="19.5" r="1.3" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-6 fill-none stroke-current stroke-[1.8]">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}
