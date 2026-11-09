import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";

// #252: CI runners settle async re-renders slower than a laptop; the 1s
// default timed out a legitimate wait (measured 1073 ms). A generous global
// async timeout removes the whole flaky family without weakening a single
// assertion — failing tests just take longer to fail.
configure({ asyncUtilTimeout: 5000 });
