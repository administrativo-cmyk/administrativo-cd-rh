import type {
  BankHoursMeasurementEntity,
  DailyAttendanceEntity,
  EmployeeEntity,
} from "@/lib/domain/administrative";

export type EmployeeQuery = {
  operationalOnly?: boolean;
  unitId?: string;
  managerId?: string;
  search?: string;
};

export interface EmployeeRepository {
  list(query?: EmployeeQuery): Promise<EmployeeEntity[]>;
  findById(id: string): Promise<EmployeeEntity | null>;
}

export interface BankHoursRepository {
  listMeasurements(employeeId: string): Promise<BankHoursMeasurementEntity[]>;
  latestMeasurement(employeeId: string, onDate: string): Promise<BankHoursMeasurementEntity | null>;
}

export interface DailyCallRepository {
  listByPeriod(employeeIds: readonly string[], startDate: string, endDate: string): Promise<DailyAttendanceEntity[]>;
  save(record: DailyAttendanceEntity): Promise<DailyAttendanceEntity>;
}
