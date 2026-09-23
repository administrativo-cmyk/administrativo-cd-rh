import type { AttendanceCode, Employee, EmployeeSituation, UnitCode } from "./daily-call-types";

const firstNames = ["Marina", "Rafael", "Camila", "Bruno", "Larissa", "Diego", "Patrícia", "André", "Aline", "Felipe", "Juliana", "Marcelo", "Renata"];
const lastNames = ["Duarte", "Nogueira", "Ribeiro", "Mendes"];
const managers = ["ALEX T1", "ANAOR", "ARMANDO", "BIANCA T2", "CARLOS M.", "DANIELA FLV"];
const units: UnitCode[] = ["CD I", "CD II", "CD FLV"];
const departments = ["Recebimento", "Expedição", "Separação", "Inventário", "FLV", "Prevenção"];
const roles = ["Auxiliar de logística", "Conferente", "Operador de empilhadeira", "Assistente administrativo", "Líder operacional"];
const codeCycle: AttendanceCode[] = ["P", "P", "P", "F", "P", "A", "P", "G", "P", "I", "H", "P", "X", "AF", "B"];

function pad(value: number) { return String(value).padStart(2, "0"); }

function getSituation(index: number): EmployeeSituation {
  if ([4, 17, 39, 48].includes(index)) return "Novo admitido";
  if ([12, 25, 38, 51].includes(index)) return "Férias";
  if ([18, 37].includes(index)) return "Afastado";
  return "Ativo";
}

function makeAttendance(index: number) {
  const attendance: Record<string, AttendanceCode> = {};
  for (let day = 1; day <= 30; day += 1) {
    let code = codeCycle[(index * 3 + day) % codeCycle.length];
    const situation = getSituation(index);
    if (situation === "Férias" && day >= 8 && day <= 20) code = "X";
    if (situation === "Afastado" && day >= 5) code = "AF";
    attendance[`2026-09-${pad(day)}`] = code;
  }
  return attendance;
}

export const initialEmployees: Employee[] = Array.from({ length: 52 }, (_, index) => {
  const situation = getSituation(index);
  const bankPattern = [4, -2, 0, 3, -1, 0, 2, 0];
  const bankDays = bankPattern[index % bankPattern.length];
  return {
    id: String(10482 + index * 17),
    name: `${firstNames[index % firstNames.length]} ${lastNames[Math.floor(index / firstNames.length) % lastNames.length]}`,
    unit: units[index % units.length],
    manager: managers[index % managers.length],
    department: departments[index % departments.length],
    role: roles[index % roles.length],
    situation,
    admissionDate: situation === "Novo admitido" ? `2026-09-${pad(2 + (index % 10))}` : `${2020 + (index % 6)}-${pad((index % 12) + 1)}-${pad((index % 25) + 1)}`,
    plannedVacation: situation === "Férias" ? "08/09 a 27/09/2026" : `${pad((index % 20) + 1)}/11/2026`,
    bankDays,
    bankHours: bankDays > 0 ? `+${pad(bankDays * 8)}:${index % 2 ? "20" : "00"}` : bankDays < 0 ? `-${pad(Math.abs(bankDays) * 8)}:${index % 2 ? "40" : "00"}` : "00:00",
    attendance: makeAttendance(index),
    observations: (index % 11 === 0 ? { "2026-09-15": "Funcionário em treinamento." } : {}) as Record<string, string>,
  };
});

export const TODAY = "2026-09-15";
export const managerOptions = managers;
