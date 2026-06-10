export type PopupDialogStateOptions<DialogKind extends string> = {
  background: HTMLElement;
  backdrop: HTMLElement;
  dialogs: Record<DialogKind, HTMLElement>;
};

export type PopupDialogState<DialogKind extends string> = {
  readonly active: DialogKind | undefined;
  open(kind: DialogKind): boolean;
  close(kind: DialogKind): boolean;
  trapTab(event: KeyboardEvent): boolean;
};

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

export function createPopupDialogState<DialogKind extends string>(
  options: PopupDialogStateOptions<DialogKind>
): PopupDialogState<DialogKind> {
  let active: DialogKind | undefined;

  return {
    get active() {
      return active;
    },

    open(kind) {
      if (active) {
        return false;
      }
      active = kind;
      options.backdrop.hidden = false;
      options.dialogs[kind].hidden = false;
      options.background.setAttribute("inert", "");
      return true;
    },

    close(kind) {
      if (active !== kind) {
        return false;
      }
      options.dialogs[kind].hidden = true;
      options.backdrop.hidden = true;
      options.background.removeAttribute("inert");
      active = undefined;
      return true;
    },

    trapTab(event) {
      if (event.key !== "Tab" || !active) {
        return false;
      }

      const dialog = options.dialogs[active];
      const focusable = focusableElements(dialog);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return true;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!focusable.includes(document.activeElement as HTMLElement)) {
        event.preventDefault();
        first.focus();
      }
      return true;
    }
  };
}
