// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { BrandMark } from "../../src/components/brand-mark";

describe("BrandMark", () => {
  afterEach(cleanup);

  it("renders the official owner-delivered logo with descriptive alt text", () => {
    render(<BrandMark />);

    const logo = screen.getByRole("img", {
      name: "Yard Toonz logo with cartoon character",
    });
    expect(logo.getAttribute("src")).toBe(
      "/brand/yard-toonz-logo-official.png",
    );
  });
});
