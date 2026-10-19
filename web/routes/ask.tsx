import { createFileRoute } from "@tanstack/react-router";

import { AskView } from "@/components/ask/AskView";

// `/ask` asks a question; `/ask?about=<subject id>` starts it about that subject (the monitor
// page's "Ask about" button).
export const Route = createFileRoute("/ask")({
  validateSearch: (search): { about?: string } => ({
    ...search,
    about: typeof search.about === "string" ? search.about : undefined,
  }),
  component: AskPage,
});

function AskPage() {
  const { about } = Route.useSearch();
  return <AskView key={about ?? ""} aboutId={about} />;
}
