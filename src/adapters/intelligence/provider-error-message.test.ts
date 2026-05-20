import assert from "node:assert/strict";
import test from "node:test";
import { providerErrorMessage } from "./provider-error-message.js";

test("provider error helper preserves provider body message", () => {
  assert.equal(
    providerErrorMessage({ status: 404, error: { message: "Cannot POST /v1/responses" }, message: "404 status code (no body)" }, "HTTP 404"),
    "Cannot POST /v1/responses"
  );
});

test("provider error helper strips SDK no-body wrapper when status uses statusCode", () => {
  assert.equal(
    providerErrorMessage({ statusCode: 404, message: "404 status code (no body)" }, "HTTP 404"),
    "HTTP 404"
  );
});
