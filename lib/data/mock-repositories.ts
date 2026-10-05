import type { Employee } from "@/lib/daily-call-types";
import { initialEmployees } from "@/lib/mock-daily-call";
import type {
  BankHoursMeasurementEntity,
  DailyAttendanceEntity,
  EmployeeEntity,
  EmployeeSituationCode,
} from "@/lib/domain/administrative";
import { isOperationalEmployee } from "@/lib/domain/administrative";
import type {
  BankHoursRepository,
  DailyCallRepository,
  EmployeeQuery,
  EmployeeRepository,
} from "@/lib/data/repositories";

const situationMap: Record<Employee["situation"], EmployeeSituationCode> = {
  Ativo: "ATIVO",
  "Férias": "FERIAS",
  "Novo admitido": "NOVO_ADMITIDO",
  Afastado: "AFASTADO",
};

function unitId(code: Employee["unit"]): string {
  return `mock-unit:${code}`;
}

function managerId(name: string): string {
  return `mock-manager:${name}`;
}

function toDomainEmployee(employee: Employee): EmployeeEntity {
  return {
    id: `mock-employee:${employee.id}`,
    employeeNumber: employee.id,
    name: employee.name,
    unitId: unitId(employee.unit),
    managerId: managerId(employee.manager),
    department: employee.department,
    role: employee.role,
    situation: situationMap[employee.situation],
    category: null,
    admissionDate: employee.admissionDate,
    movement: null,
    currentWorkdayHours: 7.3333,
    activeInSystem: true,
    observation: null,
  };
}

function parseBalanceMinutes(value: string): number {
  const sign = value.startsWith("-") ? -1 : 1;
  const [hours, minutes] = value.replace(/[+-]/, "").split(":").map(Number);
  return sign * (hours * 60 + minutes);
}

export class MockEmployeeRepository implements EmployeeRepository {
  constructor(private readonly source: readonly Employee[] = initialEmployees) {}

  async list(query: EmployeeQuery = {}): Promise<EmployeeEntity[]> {
    const search = query.search?.trim().toLocaleLowerCase("pt-BR");
    return this.source
      .map(toDomainEmployee)
      .filter((employee) => !query.operationalOnly || isOperationalEmployee(employee))
      .filter((employee) => !query.unitId || employee.unitId === query.unitId)
      .filter((employee) => !query.managerId || employee.managerId === query.managerId)
      .filter((employee) => !search
        || employee.name.toLocaleLowerCase("pt-BR").includes(search)
        || employee.employeeNumber.includes(search));
  }

  async findById(id: string): Promise<EmployeeEntity | null> {
    const employee = this.source.find((item) => `mock-employee:${item.id}` === id);
    return employee ? toDomainEmployee(employee) : null;
  }
}

export class MockBankHoursRepository implements BankHoursRepository {
  constructor(private readonly source: readonly Employee[] = initialEmployees) {}

  async listMeasurements(employeeId: string): Promise<BankHoursMeasurementEntity[]> {
    const employee = this.source.find((item) => `mock-employee:${item.id}` === employeeId);
    if (!employee) return [];
    return [{
      id: `mock-bank:${employee.id}:2026-09-01`,
      employeeId,
      measurementDate: "2026-09-01",
      effectiveFrom: "2026-09-01",
      workdayHours: 7.3333,
      balanceMinutes: parseBalanceMinutes(employee.bankHours ?? "00:00"),
      source: "mock",
      importBatchId: null,
    }];
  }

  async latestMeasurement(employeeId: string, onDate: string): Promise<BankHoursMeasurementEntity | null> {
    const measurements = await this.listMeasurements(employeeId);
    return measurements
      .filter((measurement) => measurement.effectiveFrom <= onDate)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
  }
}

export class MockDailyCallRepository implements DailyCallRepository {
  private readonly records = new Map<string, DailyAttendanceEntity>();

  constructor(private readonly source: readonly Employee[] = initialEmployees) {
    source.forEach((employee) => {
      Object.entries(employee.attendance).forEach(([date, status]) => {
        const employeeId = `mock-employee:${employee.id}`;
        this.records.set(`${employeeId}:${date}`, {
          employeeId,
          date,
          status,
          observation: employee.observations[date] ?? null,
        });
      });
    });
  }

  async listByPeriod(employeeIds: readonly string[], startDate: string, endDate: string): Promise<DailyAttendanceEntity[]> {
    const allowed = new Set(employeeIds);
    return [...this.records.values()].filter((record) => (
      allowed.has(record.employeeId) && record.date >= startDate && record.date <= endDate
    ));
  }

  async save(record: DailyAttendanceEntity): Promise<DailyAttendanceEntity> {
    this.records.set(`${record.employeeId}:${record.date}`, { ...record });
    return { ...record };
  }
}
