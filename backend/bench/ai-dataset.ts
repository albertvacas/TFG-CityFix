/**
 * Conjunt d'avaluació per a la classificació automàtica (RF-14).
 *
 * Subconjunt representatiu de 10 casos realistes de campus. Tot i ser reduït,
 * cobreix les 9 categories, els 4 nivells de prioritat i inclou deliberadament
 * situacions on l'usuari ha triat una categoria EQUIVOCADA (`userCategory`) per
 * avaluar la capacitat de correcció del model.
 *
 * La prioritat és inherentment subjectiva; per això l'avaluador reporta tant
 * l'encert exacte com l'encert "± 1 nivell" (vegeu eval-ai.ts).
 *
 * Tot text-only: la classificació multimodal amb imatge s'avalua a part de
 * forma qualitativa, ja que requeriria allotjar imatges accessibles per URL.
 */

import type { Category, Priority } from '../generated/prisma';

export interface EvalCase {
  id: string;
  title: string;
  description: string;
  /** Categoria triada per l'usuari (pot ser nul·la o incorrecta a propòsit). */
  userCategory: Category | null;
  expectedCategory: Category;
  expectedPriority: Priority;
  /** Per a la discussió qualitativa de l'informe. */
  note: string;
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'C02',
    title: 'Tub fluorescent parpellejant a la biblioteca',
    description:
      'Un dels tubs de la sala de lectura parpelleja constantment i molesta per estudiar.',
    userCategory: 'LIGHTING',
    expectedCategory: 'LIGHTING',
    expectedPriority: 'LOW',
    note: 'Categoria òbvia però impacte només estètic/molèstia: prioritat baixa.',
  },
  {
    id: 'C05',
    title: 'Forat profund al camí d\'accés',
    description:
      'Hi ha un sot d\'uns 20 cm de fondària al mig del camí que va a l\'edifici Q. Una bici hi pot caure.',
    userCategory: 'PAVEMENT',
    expectedCategory: 'PAVEMENT',
    expectedPriority: 'HIGH',
    note: 'Risc de caiguda clar.',
  },
  {
    id: 'C08',
    title: 'Branca a punt de caure',
    description:
      'Una branca grossa d\'un pi del passeig està mig trencada i penja sobre la zona de pas dels vianants.',
    userCategory: 'GREEN_AREAS',
    expectedCategory: 'GREEN_AREAS',
    expectedPriority: 'CRITICAL',
    note: 'Risc imminent de caiguda sobre persones: crític.',
  },
  {
    id: 'C10',
    title: 'Semàfor de vianants avariat',
    description:
      'El semàfor del pas de vianants de l\'entrada principal no canvia mai a verd per als vianants.',
    userCategory: 'SIGNAGE',
    expectedCategory: 'SIGNAGE',
    expectedPriority: 'CRITICAL',
    note: 'Seguretat viària: crític.',
  },
  {
    id: 'C12',
    title: 'Rampa d\'accés bloquejada',
    description:
      'Han deixat unes tanques d\'obra que tapen completament la rampa per a cadires de rodes de l\'edifici C. No hi ha alternativa accessible.',
    userCategory: 'ACCESSIBILITY',
    expectedCategory: 'ACCESSIBILITY',
    expectedPriority: 'HIGH',
    note: 'Accessibilitat anul·lada: alta.',
  },
  {
    id: 'C13',
    title: 'Pantalla informativa apagada',
    description:
      'La pantalla d\'horaris del vestíbul de l\'edifici A està en negre des d\'aquest matí.',
    userCategory: 'TECHNOLOGY',
    expectedCategory: 'TECHNOLOGY',
    expectedPriority: 'LOW',
    note: 'Servei digital no crític.',
  },
  {
    id: 'C15',
    title: 'Hi ha vidres trencats per terra',
    description:
      'Algú ha trencat una ampolla i hi ha vidres escampats per tota la entrada de l\'edifici D.',
    userCategory: 'PAVEMENT',
    expectedCategory: 'CLEANING',
    expectedPriority: 'HIGH',
    note: 'L\'usuari diu PAVEMENT però és neteja (residus) amb risc de tall: correcció + prioritat alta.',
  },
  {
    id: 'C16',
    title: 'Paperera cremada',
    description:
      'Una paperera metàl·lica de la zona d\'autobusos està mig fosa, sembla que algú li ha calat foc.',
    userCategory: 'CLEANING',
    expectedCategory: 'URBAN_FURNITURE',
    expectedPriority: 'MEDIUM',
    note: 'L\'usuari diu CLEANING però el bé danyat és mobiliari urbà.',
  },
  {
    id: 'C17',
    title: 'Cable elèctric penjant',
    description:
      'D\'una columna de l\'aparcament en penja un cable elèctric pelat a l\'altura del cap. Sembla que té corrent.',
    userCategory: null,
    expectedCategory: 'TECHNOLOGY',
    expectedPriority: 'CRITICAL',
    note: 'Sense categoria d\'usuari; risc elèctric imminent: crític. Frontera amb LIGHTING/OTHER.',
  },
  {
    id: 'C18',
    title: 'Degoteig al sostre del passadís',
    description:
      'Cau aigua del sostre del passadís del primer pis quan plou i el terra queda relliscós.',
    userCategory: null,
    expectedCategory: 'OTHER',
    expectedPriority: 'MEDIUM',
    note: 'No encaixa clarament en cap categoria (fuita): hauria de caure a OTHER. Cas difícil.',
  },
];
