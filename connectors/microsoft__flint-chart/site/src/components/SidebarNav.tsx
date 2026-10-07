import { useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { siteTheme } from '../shared/theme';

export const SIDEBAR_NAV_WIDTH = 240;
const SIDEBAR_NAV_CHROME_OFFSET = 80;

type SidebarNavProps = {
  sidebarRef?: Ref<HTMLElement>;
  children: ReactNode;
  style?: CSSProperties;
};

export function SidebarNav({ sidebarRef, children, style }: SidebarNavProps) {
  return (
    <aside
      ref={sidebarRef}
      className="app-sidebar"
      style={{
        width: SIDEBAR_NAV_WIDTH,
        flexShrink: 0,
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        height: `calc(100vh - ${SIDEBAR_NAV_CHROME_OFFSET}px)`,
        maxHeight: `calc(100vh - ${SIDEBAR_NAV_CHROME_OFFSET}px)`,
        overflowY: 'auto',
        overflowX: 'hidden',
        overscrollBehavior: 'contain',
        background: 'transparent',
        padding: '20px 14px 28px',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {children}
    </aside>
  );
}

export function SidebarNavSection({
  label,
  first = false,
  children,
}: {
  label: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        marginTop: first ? 0 : 18,
        marginBottom: 6,
        paddingTop: first ? 0 : 14,
        borderTop: first ? 'none' : `1px solid ${siteTheme.border}`,
      }}
    >
      <div style={sidebarNavHeadingStyle}>{label}</div>
      {children}
    </section>
  );
}

type SidebarNavItemProps = {
  active: boolean;
  children: ReactNode;
  as?: 'button' | 'link';
  icon?: string;
  onClick?: () => void;
  to?: string;
  dataAttr?: Record<string, string>;
};

export function SidebarNavItem({
  active,
  children,
  as = 'button',
  icon,
  onClick,
  to = '#',
  dataAttr,
}: SidebarNavItemProps) {
  const [hovered, setHovered] = useState(false);
  const itemStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: icon ? 9 : 0,
    width: '100%',
    minHeight: 31,
    marginBottom: 0,
    padding: '5px 12px 5px 16px',
    border: 0,
    borderRadius: 10,
    textAlign: 'left',
    textDecoration: 'none',
    background: active ? 'rgba(31, 35, 40, 0.10)' : hovered ? 'rgba(31, 35, 40, 0.06)' : 'transparent',
    color: siteTheme.text,
    cursor: 'pointer',
    font: 'inherit',
    fontSize: 13,
    lineHeight: 1.4,
    fontWeight: active ? 600 : 400,
    boxSizing: 'border-box',
    transition: 'background-color 120ms ease, color 120ms ease',
  };
  const itemContent = (
    <>
      {icon ? (
        <img
          src={icon}
          alt=""
          aria-hidden="true"
          style={{ width: 17, height: 17, flexShrink: 0 }}
        />
      ) : null}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {children}
      </span>
    </>
  );
  const eventProps = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };

  if (as === 'link') {
    return (
      <Link to={to} style={itemStyle} {...dataAttr} {...eventProps}>
        {itemContent}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      style={itemStyle}
      {...dataAttr}
      {...eventProps}
    >
      {itemContent}
    </button>
  );
}

const sidebarNavHeadingStyle: CSSProperties = {
  padding: '0 12px 6px 16px',
  fontSize: 13.5,
  fontWeight: 600,
  letterSpacing: 0,
  color: siteTheme.text,
};
