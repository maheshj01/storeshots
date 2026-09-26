import { create } from "zustand";

interface ToastState {
  message: string | null;
  bad: boolean;
}

export const useToast = create<ToastState>(() => ({ message: null, bad: false }));

let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short status line at the bottom of the window. */
export function toast(message: string, bad = false) {
  useToast.setState({ message, bad });
  clearTimeout(timer);
  timer = setTimeout(() => useToast.setState({ message: null }), bad ? 6000 : 3000);
}
