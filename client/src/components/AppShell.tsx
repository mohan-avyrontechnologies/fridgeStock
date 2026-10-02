import {
  ArrowLeft,
  Bell,
  CalendarDays,
  ChartColumn,
  CookingPot,
  History,
  House,
  Plus,
  Settings,
  ShoppingCart,
  Users,
} from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAuthStore } from '../stores/authStore';
import { useFoodStore } from '../stores/foodStore';
import { useNotificationStore } from '../stores/notificationStore';
import { Toast } from './ui';

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

const iconProps = { 'aria-hidden': true, className: 'size-6 shrink-0', strokeWidth: 1.9 } as const;

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
      <div className="flex min-h-16 items-center gap-2 px-4 py-2 lg:px-8 lg:pt-8 lg:pb-2">
        {back && (
          <Link
            to={back}
            aria-label="Back"
            className="-ml-2 grid size-12 place-items-center rounded-full hover:bg-brand-soft"
          >
            <ArrowLeft {...iconProps} />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight lg:text-3xl">{title}</h1>
          {subtitle && <p className="truncate text-sm text-muted lg:mt-1 lg:text-base">{subtitle}</p>}
        </div>
        <Link
          to="/notifications"
          aria-label={unread ? `Reminders, ${unread} unread` : 'Reminders'}
          className={`relative grid size-12 place-items-center rounded-full hover:bg-brand-soft ${showIcons ? '' : 'lg:hidden'}`}
        >
          <Bell {...iconProps} />
          <UnreadDot count={unread} className="absolute top-1.5 right-1.5" />
        </Link>
        {/* On phones Settings lives here (the bottom bar holds Shopping and Plan); on desktop it's in the sidebar. */}
        <Link
          to="/settings"
          aria-label="Open settings"
          className={`grid size-12 place-items-center rounded-full hover:bg-brand-soft ${showIcons ? '' : 'lg:hidden'}`}
        >
          <Settings {...iconProps} />
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
      className={`grid min-w-5 place-items-center rounded-full bg-past-bar px-1 text-xs font-bold text-on-brand ${className}`}
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
    `flex min-h-12 items-center gap-3 rounded-button px-3 text-base font-medium transition-colors ${
      isActive ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-paper'
    }`;

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-line bg-card px-4 py-6 lg:flex">
      <Link to="/" className="flex min-h-12 items-center gap-2.5 px-2">
        <img src="/icon.svg" alt="" className="size-9" />
        <span className="font-display text-lg font-bold tracking-tight">Cook First</span>
      </Link>

      <Link
        to="/add"
        className="mt-8 flex min-h-12 items-center justify-center gap-2 rounded-button bg-brand px-4 font-semibold text-on-brand hover:bg-brand-hover"
      >
        <Plus aria-hidden className="size-5" strokeWidth={2.5} />
        Add food
      </Link>

      <nav aria-label="Main" className="mt-6">
        <ul className="space-y-1">
          <li>
            <NavLink to="/" end className={item}>
              <House {...iconProps} /> Home
            </NavLink>
          </li>
          <li>
            <NavLink to="/cook-first" className={item}>
              <CookingPot {...iconProps} /> <span className="flex-1">Cook First</span>
              {cookFirstCount > 0 && (
                <span className="grid min-w-6 place-items-center rounded-full bg-past-bar px-1.5 text-xs font-bold text-on-brand">
                  {cookFirstCount}
                </span>
              )}
            </NavLink>
          </li>
          <li>
            <NavLink to="/shopping" className={item}>
              <ShoppingCart {...iconProps} /> Shopping
            </NavLink>
          </li>
          <li>
            <NavLink to="/plan" className={item}>
              <CalendarDays {...iconProps} /> Meal plan
            </NavLink>
          </li>
          <li>
            <NavLink
              to="/notifications"
              className={item}
              aria-label={unread ? `Reminders, ${unread} unread` : 'Reminders'}
            >
              <Bell {...iconProps} /> <span className="flex-1">Reminders</span>
              <UnreadDot count={unread} className="min-w-6 px-1.5 text-xs" />
            </NavLink>
          </li>
          <li>
            <NavLink to="/household" className={item}>
              <Users {...iconProps} /> Household
            </NavLink>
          </li>
          <li>
            <NavLink to="/insights" className={item}>
              <ChartColumn {...iconProps} /> Insights
            </NavLink>
          </li>
          <li>
            <NavLink to="/history" className={item}>
              <History {...iconProps} /> History
            </NavLink>
          </li>
          <li>
            <NavLink to="/settings" className={item}>
              <Settings {...iconProps} /> Settings
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
        <NavItem to="/" label="Home" icon={<House {...iconProps} />} end />
        <NavItem to="/cook-first" label="Cook First" icon={<CookingPot {...iconProps} />} badge={cookFirstCount} />
        <li className="flex justify-center">
          <Link to="/add" className="flex flex-col items-center gap-0.5 pb-1.5 text-xs font-semibold text-brand">
            <span className="-mt-5 grid size-14 place-items-center rounded-full bg-brand text-on-brand shadow-lg shadow-brand/30 hover:bg-brand-hover">
              <Plus aria-hidden className="size-7" strokeWidth={2.5} />
            </span>
            Add food
          </Link>
        </li>
        <NavItem to="/shopping" label="Shopping" icon={<ShoppingCart {...iconProps} />} />
        <NavItem to="/plan" label="Plan" icon={<CalendarDays {...iconProps} />} />
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
          `relative flex min-h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
            isActive ? 'text-brand' : 'text-muted'
          }`
        }
      >
        {icon}
        {label}
        {!!badge && (
          <span className="absolute top-2 left-1/2 ml-2 grid min-w-5 place-items-center rounded-full bg-past-bar px-1 text-xs font-bold text-on-brand">
            {badge}
          </span>
        )}
      </NavLink>
    </li>
  );
}
