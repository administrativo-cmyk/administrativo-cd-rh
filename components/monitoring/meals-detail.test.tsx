import { render,screen } from "@testing-library/react";
import { describe,it,expect } from "vitest";
import { MealsDetail } from "./meals-detail";
describe("detalhes das refeições sem descanso",()=>{
 it("diferencia exclusão de zero e preserva justificativa",()=>{
  const {rerender}=render(<MealsDetail meals={{count:null,quality:"excluded",eligibility:{state:"excluded",policyIds:["cozinha"],reasons:["Cozinha fora do indicador"]},visits:[]}}/>);
  expect(screen.getByText("Excluído por regra")).toBeInTheDocument();expect(screen.getByText("Cozinha fora do indicador")).toBeInTheDocument();
  rerender(<MealsDetail meals={{count:0,quality:"complete",eligibility:{state:"eligible",policyIds:[],reasons:[]},visits:[]}}/>);
  expect(screen.getByText("0 vez(es)")).toBeInTheDocument();
 });
 it("resultado antigo sem contador exige nova apuração",()=>{
  render(<MealsDetail/>);expect(screen.getAllByText("Não apurável").length).toBeGreaterThan(0);
 });
});
