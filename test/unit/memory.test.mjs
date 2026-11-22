import { test } from "node:test";
import assert from "node:assert/strict";
import { autoConcurrency, parseMeminfo, parseVmStat, readMemory } from "../../dist/memory.js";

test("linux meminfo", () => {
  const m = parseMeminfo("MemTotal:       16000000 kB\nMemFree:  1000000 kB\nMemAvailable:    8000000 kB\nSwapTotal: 2000000 kB\nSwapFree: 1000000 kB\n", null);
  assert.equal(Math.round(m.totalGB), 15);
  assert.equal(m.availableMB, 7813);
  assert.equal(m.pressure, "normal");
  assert.ok(m.swapUsedGB > 0.9 && m.swapUsedGB < 1);
});

test("linux: memory pressure stall info raises the level", () => {
  const m = parseMeminfo("MemTotal: 16000000 kB\nMemAvailable: 8000000 kB\n", "some avg10=63.10 avg60=1 avg300=1 total=1\nfull avg10=0 avg60=0 avg300=0 total=0");
  assert.equal(m.pressure, "critical");
});

test("linux: little memory left is critical", () => {
  assert.equal(parseMeminfo("MemTotal: 8000000 kB\nMemAvailable: 300000 kB\n", null).pressure, "critical");
});

test("macOS vm_stat", () => {
  const vm = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10000.
Pages active:                            200000.
Pages inactive:                          150000.
Pages speculative:                         5000.
Pages wired down:                         90000.
Pages purgeable:                           2000.
Anonymous pages:                         250000.
Pages occupied by compressor:             30000.`;
  const m = parseVmStat(vm, 8 * 1073741824, "total = 2048.00M  used = 512.00M  free = 1536.00M", 2);
  assert.equal(m.pressure, "warning");
  assert.equal(m.swapUsedGB, 0.5);
  assert.equal(m.availableMB, Math.round((10000 + 150000 + 5000 + 2000) * 16384 / 1048576));
});

test("auto threads: small machines get one", () => {
  const mem = (totalGB, availableMB, pressure = "normal") => ({ platform: "x", totalGB, availableMB, usedGB: 0, swapUsedGB: 0, pressure });
  assert.equal(autoConcurrency(mem(8, 4000), 8), 1);
  assert.equal(autoConcurrency(mem(16, 9000), 8), 2);
  assert.equal(autoConcurrency(mem(64, 40000), 16), 6);
  assert.equal(autoConcurrency(mem(64, 40000, "warning"), 16), 1);
  assert.equal(autoConcurrency(mem(32, 2000), 16), 1, "limited by free memory");
  assert.equal(autoConcurrency(null), 1);
});

test("reads this machine", () => {
  const m = readMemory();
  assert.ok(m && m.totalGB > 0 && m.availableMB > 0);
});
