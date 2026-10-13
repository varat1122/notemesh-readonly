import { createResource, For, Show } from "solid-js";
import { AdminShell, Snippet } from "~/components/AdminShell";
import { api } from "~/lib/api";

/**
 * What this server can do, as its clients see it.
 *
 * The list comes from a real tools/list against a real MCP server instance, so
 * it is the tool surface rather than a description of it — nothing here is
 * written down twice.
 */
export default function Tools() {
  const [data] = createResource(() => api.getToolsPage());

  return (
    <AdminShell>
      <Show when={data()} keyed>
        {(d) => (
          <>
            <article>
              <header>
                <strong>MCP tools</strong>
              </header>
              <p class="muted">
                This server supports {d.tools.length} tools: {d.readCount} read-only tools and{" "}
                {d.writeCount} tool for submitting new analysis to the inbox queue.
                Each connection sees only the tools allowed by its granted scopes.
                Editing and deleting existing vault notes are disabled.
              </p>
              <Snippet text={d.endpoint} />

              <For each={[false, true]}>
                {(write) => (
                  <Show when={d.tools.some((t) => t.write === write)}>
                    <h4 class="tool-group">{write ? "Submit new analysis" : "Read notes and status"}</h4>
                    <p class="muted">
                      {write
                        ? "Requires vault:read and inbox:submit approved through OAuth. Queued submissions are imported as new linked notes by the computer receiver; a queue receipt does not prove Sync has finished."
                        : "Vault tools require vault:read. Submission status additionally requires inbox:submit. API keys do not grant MCP submission access."}
                    </p>
                    <For each={d.tools.filter((t) => t.write === write)}>
                      {(t) => (
                        <div class="tool">
                          <code class="tool-name">{t.name}</code>
                          <Show when={t.intake}><span class="muted tool-type"> · requires inbox:submit</span></Show>
                          <Show when={t.annotations?.destructiveHint}>
                            <span class="muted tool-type"> · can discard content; a client may ask first</span>
                          </Show>
                          <p>{t.description}</p>
                          <Show when={t.params.length}>
                            <p class="muted tool-params">
                              <For each={t.params}>
                                {(p, i) => (
                                  <>
                                    {i() > 0 ? ", " : ""}
                                    <code>{p.name}</code>
                                    <span class="tool-type">
                                      {" "}
                                      {p.type}
                                      {p.required ? "" : "?"}
                                    </span>
                                    <Show when={p.description}>
                                      <span class="tool-type"> — {p.description}</span>
                                    </Show>
                                  </>
                                )}
                              </For>
                            </p>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                )}
              </For>
            </article>
          </>
        )}
      </Show>
    </AdminShell>
  );
}
