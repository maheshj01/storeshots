import { useEditor } from "./state/store.ts";
import { Editor } from "./ui/Editor.tsx";
import { Home } from "./ui/Home.tsx";
import { useToast } from "./ui/toast.ts";

export function App() {
  const open = useEditor((s) => s.doc !== null);
  const toast = useToast();
  return (
    <>
      {open ? <Editor /> : <Home />}
      {toast.message && (
        <div className={`toast${toast.bad ? " bad" : ""}`} role="status">
          {toast.message}
        </div>
      )}
    </>
  );
}
