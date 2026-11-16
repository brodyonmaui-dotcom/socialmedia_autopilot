// Design system v3 (Quiet dashboard) — see docs/design/ui-system.md. Pages import from here.
export * from "./cx.js";
export * from "./Icon.js";
export * from "./PlatformLogo.js";
export * from "./theme.js";
export * from "./ThemeToggle.js";
// getTheme() lives in ./theme-server.js (server-only, not re-exported here).
// Shell
export * from "./AppShell.js";
export * from "./Sidebar.js";
export * from "./sidebar-timing.js";
export * from "./IconButton.js";
export * from "./CommandPalette.js";
export * from "./NotificationsPopover.js";
// Overlays
export * from "./Popover.js";
export * from "./popover-position.js";
export * from "./Menu.js";
export * from "./Dropdown.js";
export * from "./Dialog.js";
export * from "./Sheet.js";
export * from "./Tooltip.js";
// Layout
export * from "./PageHeader.js";
export * from "./Card.js";
export * from "./StatTile.js";
export * from "./Thumb.js";
export * from "./DataRow.js";
export * from "./ListRow.js";
export * from "./EmptyState.js";
// Controls
export * from "./Button.js";
export * from "./Toggle.js";
export * from "./Checkbox.js";
export * from "./Radio.js";
export * from "./Tabs.js";
export * from "./Badge.js";
export * from "./Input.js";
export * from "./Textarea.js";
export * from "./Select.js";
export * from "./Stepper.js";
export * from "./ProgressBar.js";
export * from "./Slider.js";
export * from "./AlertCard.js";
export * from "./PageDots.js";
// Data viz
export * from "./BarChart.js";
export * from "./LineChart.js";
export * from "./chart-scale.js";
export * from "./Sparkline.js";
export * from "./Donut.js";
export * from "./MonthCalendar.js";
export * from "./chart-math.js";

// ---- v2 leftovers: still imported by pages not rebuilt yet. They render nothing (GridLines, NoiseOverlay,
// Marquee, FooterBand) or render v3-style (SectionHead, Display, Readout, StatusPulse). Delete each
// file and its export once nothing imports it (ui-system.md "Removed").
export * from "./GridLines.js";
export * from "./NoiseOverlay.js";
export * from "./SectionHead.js";
export * from "./FooterBand.js";
export * from "./Display.js";
export * from "./Readout.js";
export * from "./StatusPulse.js";
export * from "./Marquee.js";
export * from "./RevealList.js";
export * from "./FramedImage.js";
export * from "./GlassCard.js";
export * from "./StatusBars.js";
export * from "./Statement.js";
export * from "./SiteHeader.js";
export * from "./HeaderMenu.js";
export * from "./TabBar.js";
