// An entity's peers: the other members of the groups it belongs to, read from each group's subject
// detail (the same cache entries useSubject fills). The monitor page head names them, and a bank's
// "Shared with" picks from them.
import { useQueries } from "@tanstack/react-query";

import { api, type Schema } from "./client";
import { ApiError, keys } from "./queries";

type SubjectRef = Schema<"SubjectRef">;

/** The entity's peers in group order, or undefined while it or its groups load. Other subject types have none. */
export function usePeers(subject: Schema<"SubjectDetail"> | undefined): SubjectRef[] | undefined {
  const groups = subject?.type === "entity" ? subject.links.groups : [];
  return useQueries({
    queries: groups.map((g) => ({
      queryKey: keys.subject(g.id),
      queryFn: async () => {
        const { data, error, response } = await api.GET("/subjects/{subject_id}", { params: { path: { subject_id: g.id } } });
        if (data === undefined) throw new ApiError(response.status, error);
        return data;
      },
    })),
    combine: (results) => {
      if (!subject || results.some((r) => r.isPending)) return undefined;
      const peers = new Map<string, SubjectRef>();
      for (const member of results.flatMap((r) => r.data?.links.entities ?? [])) {
        if (member.id !== subject.id) peers.set(member.id, member);
      }
      return [...peers.values()];
    },
  });
}
