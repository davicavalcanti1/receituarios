import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatProblemType(problem: string | null | undefined): string {
  if (!problem) return "";
  return problem
    .replace(/_/g, " ")
    .toLowerCase()
    .split(" ")
    .map((word) => (word ? word.charAt(0).toLocaleUpperCase("pt-BR") + word.slice(1) : ""))
    .join(" ");
}
