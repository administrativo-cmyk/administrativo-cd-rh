import type { Metadata } from "next";
import { DashboardPage, type DashboardPageProps } from "@/components/dashboards/dashboard-page";
export const metadata: Metadata = { title: "Dashboard do Quadro Atual | Administrativo CD" };
export default function Page(props: DashboardPageProps) { return <DashboardPage {...props} domain="quadro-atual" />; }
