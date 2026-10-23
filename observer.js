// Incremental observer for a copied SSE response stream. Owns parsing and
// bounded observation; never touches the bytes that are forwarded to the
// client. The request path owns the bytes; this module owns the copy.
export const SSE_OBSERVATION_BYTE_BOUND = 262144;

export function createSseObserver(onUsage) {
  const observer = {
    buffer: "",
    decoder: new TextDecoder("utf-8", { stream: true }),
    detached: false,
    finished: false,
    captured: null,

    observe(chunk) {
      if (this.finished || this.detached) return;
      try {
        const text = this.decoder.decode(chunk, { stream: true });
        this.buffer += text;
        this.processBuffer();
      } catch (error) {
        this.detach();
      }
    },

    processBuffer() {
      if (this.detached) return;
      while (!this.detached) {
        const boundary = this.findBoundary(this.buffer);
        if (boundary.index < 0) break;
        const eventText = this.buffer.slice(0, boundary.index);
        this.buffer = this.buffer.slice(boundary.index + boundary.length);
        this.handleEvent(eventText);
      }
      if (this.detached) return;
      const bytes = Buffer.byteLength(this.buffer, "utf8");
      if (bytes > SSE_OBSERVATION_BYTE_BOUND) {
        this.detach();
      }
    },

    findBoundary(buffer) {
      const candidates = [
        { token: "\r\n\r\n", length: 4 },
        { token: "\n\n", length: 2 },
        { token: "\r\r", length: 2 },
      ];
      let bestIndex = -1;
      let bestLength = 0;
      for (const candidate of candidates) {
        const index = buffer.indexOf(candidate.token);
        if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
          bestIndex = index;
          bestLength = candidate.length;
        }
      }
      return { index: bestIndex, length: bestLength };
    },

    handleEvent(eventText) {
      if (this.detached) return;
      const lines = eventText.split(/\r\n|\r|\n/);
      let data = "";
      for (const line of lines) {
        if (line.startsWith("data:")) {
          let value = line.slice(5);
          if (value.startsWith(" ")) value = value.slice(1);
          data += value + "\n";
        }
      }
      if (data.endsWith("\n")) data = data.slice(0, -1);
      if (data === "" || data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const usage = json?.usage;
        if (this.isValidUsage(usage)) {
          this.captured = this.usageTotal(usage);
        }
      } catch (error) {
        // Malformed usage or event: retain any previously captured usage.
      }
    },

    isValidUsage(usage) {
      if (!usage || typeof usage !== "object" || Array.isArray(usage)) return false;
      if (
        Number.isFinite(usage.total_tokens) &&
        usage.total_tokens >= 0
      ) {
        return true;
      }
      return (
        Number.isFinite(usage.prompt_tokens) &&
        usage.prompt_tokens >= 0 &&
        Number.isFinite(usage.completion_tokens) &&
        usage.completion_tokens >= 0
      );
    },

    usageTotal(usage) {
      if (Number.isFinite(usage.total_tokens)) return usage.total_tokens;
      return usage.prompt_tokens + usage.completion_tokens;
    },

    detach() {
      this.detached = true;
      this.buffer = "";
    },

    end() {
      if (this.finished) return;
      try {
        if (!this.detached) {
          const tail = this.decoder.decode();
          this.buffer += tail;
          this.processBuffer();
          if (!this.detached && this.buffer.trim() !== "") {
            const bytes = Buffer.byteLength(this.buffer, "utf8");
            if (bytes <= SSE_OBSERVATION_BYTE_BOUND) {
              this.handleEvent(this.buffer);
            } else {
              this.detach();
            }
          }
        }
      } catch (error) {
        this.detach();
      }
      this.finished = true;
      if (typeof onUsage === "function") onUsage(this.captured);
    },
  };
  return observer;
}
