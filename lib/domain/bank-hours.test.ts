import { describe, expect, it } from "vitest";
import { calculateCompensationCycle, convertHoursToDays, convertMinutesToDays, formatSignedMinutes } from "./bank-hours";
import { isOperationalEmployee, type EmployeeEntity, type EmployeeSituationCode } from "./administrative";

describe("convertHoursToDays", () => {
  it.each([
    ["zero", 0, 7.3333, 0],
    ["positivo menor que a jornada", 4, 7.3333, 0],
    ["exatamente uma jornada", 7.3333, 7.3333, 1],
    ["várias jornadas", 22, 7.3333, 3],
    ["resto abaixo de 5h", 11.3333, 7.3333, 1],
    ["resto exatamente 5h", 12.3333, 7.3333, 1],
    ["resto acima de 5h", 12.35, 7.3333, 2],
    ["negativo abaixo de 5h", -11.3333, 7.3333, -1],
    ["negativo acima de 5h", -12.35, 7.3333, -2],
    ["jornada 12h", 17, 12, 1],
    ["jornada 12h e resto acima", 17.0167, 12, 2],
    ["jornada 6h", 11, 6, 1],
    ["jornada 4h", 9, 4, 2],
  ])("converte %s", (_label, balance, workday, expected) => {
    expect(convertHoursToDays(balance as number, workday as number)).toBe(expected);
  });

  it("rejeita jornada inválida", () => {
    expect(() => convertHoursToDays(8, 0)).toThrow(RangeError);
  });
});

describe("minutos assinados do banco de horas", () => {
  it.each([
    [0, 440, 0], [440, 440, 1], [740, 440, 1], [741, 440, 2],
    [-440, 440, -1], [-740, 440, -1], [-741, 440, -2],
    [240, 240, 1], [540, 240, 2], [360, 360, 1],
    [660, 360, 1], [661, 360, 2], [720, 720, 1],
    [1020, 720, 1], [1021, 720, 2],
  ])("converte %i minutos com jornada %i em %i dias", (balance, workday, expected) => {
    expect(convertMinutesToDays(balance, workday)).toBe(expected);
  });

  it.each([
    [0, "00:00"], [480, "+08:00"], [-310, "-05:10"], [740, "+12:20"],
  ])("formata %i minutos como %s sem arredondar", (balance, expected) => {
    expect(formatSignedMinutes(balance)).toBe(expected);
  });

  it("rejeita minutos fracionários ou jornada inválida", () => {
    expect(() => convertMinutesToDays(1.5, 440)).toThrow(RangeError);
    expect(() => convertMinutesToDays(440, 0)).toThrow(RangeError);
    expect(() => formatSignedMinutes(1.5)).toThrow(RangeError);
  });
});

describe("calculateCompensationCycle", () => {
  it("G reduz saldo positivo sucessivamente sem ficar negativo", () => {
    expect(calculateCompensationCycle({
      balanceDays: 2,
      effectiveFrom: "2026-09-13",
      attendance: [
        { date: "2026-09-14", status: "G" },
        { date: "2026-09-15", status: "G" },
        { date: "2026-09-16", status: "G" },
      ],
    })).toMatchObject({ pendingCompensationDays: 0, compensationDaysUsed: 3, situation: "EM_DIA" });
  });

  it("G não reduz saldo negativo", () => {
    expect(calculateCompensationCycle({
      balanceDays: -3,
      effectiveFrom: "2026-09-13",
      attendance: [{ date: "2026-09-14", status: "G" }],
    })).toMatchObject({ replacementDays: 3, compensationDaysUsed: 0, situation: "A_REPOR" });
  });

  it("saldo positivo pendente fica A_COMPENSAR", () => {
    expect(calculateCompensationCycle({
      balanceDays: 4,
      effectiveFrom: "2026-09-13",
      attendance: [{ date: "2026-09-14", status: "G" }],
    }).situation).toBe("A_COMPENSAR");
  });

  it("nova baseline não reutiliza G do ciclo anterior", () => {
    const attendance = [
      { date: "2026-09-14", status: "G" as const },
      { date: "2026-09-15", status: "G" as const },
      { date: "2026-09-21", status: "G" as const },
    ];

    const firstCycle = calculateCompensationCycle({
      balanceDays: 4,
      effectiveFrom: "2026-09-13",
      nextEffectiveFrom: "2026-09-20",
      attendance,
    });
    const newCycleBeforeG = calculateCompensationCycle({
      balanceDays: 3,
      effectiveFrom: "2026-09-20",
      nextEffectiveFrom: null,
      attendance: attendance.filter((record) => record.date < "2026-09-21"),
    });
    const newCycleAfterG = calculateCompensationCycle({
      balanceDays: 3,
      effectiveFrom: "2026-09-20",
      nextEffectiveFrom: null,
      attendance,
    });

    expect(firstCycle.pendingCompensationDays).toBe(2);
    expect(newCycleBeforeG.pendingCompensationDays).toBe(3);
    expect(newCycleAfterG.pendingCompensationDays).toBe(2);
  });
});

describe("isOperationalEmployee", () => {
  const employee = (situation: EmployeeSituationCode): EmployeeEntity => ({
    id: situation,
    employeeNumber: situation,
    name: situation,
    unitId: "unit",
    managerId: null,
    department: null,
    role: null,
    situation,
    category: null,
    admissionDate: null,
    movement: null,
    currentWorkdayHours: 7.3333,
    activeInSystem: true,
    observation: null,
  });

  it.each(["ATIVO", "FERIAS", "NOVO_ADMITIDO"] as const)("inclui %s", (situation) => {
    expect(isOperationalEmployee(employee(situation))).toBe(true);
  });

  it.each(["AFASTADO", "DESLIGADO", "AVISO_PREVIO"] as const)("exclui %s", (situation) => {
    expect(isOperationalEmployee(employee(situation))).toBe(false);
  });
});
