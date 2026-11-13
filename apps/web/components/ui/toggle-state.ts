/** Next checked state for a Toggle press: disabled toggles never change. */
export function nextToggleState(current: boolean, disabled: boolean): boolean {
  return disabled ? current : !current;
}
