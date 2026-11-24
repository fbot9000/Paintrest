/**
 * Handlelisten (O-14). See src/domain/shopping.ts for what is on the list.
 * Every command is one transaction and writes change_record.
 */
import type { ShoppingCommands } from '../domain/commands';
import { CommandError } from '../domain/commands';
import { newId, now } from '../domain/ids';
import { SHOPPING_PRIORITIES, needOf, planNeeds } from '../domain/shopping';
import type { Id, ShoppingNeed, ShoppingPriority, Tables } from '../domain/types';
import { ownershipOf } from '../domain/views';
import type { Store } from './store';
import { must, record, setOwn } from './tx-helpers';

function priorityOf(p: unknown): ShoppingPriority {
  if (!SHOPPING_PRIORITIES.includes(p as ShoppingPriority)) throw new CommandError('Ukjent prioritet');
  return p as ShoppingPriority;
}

function livePaint(t: Tables, product_id: Id) {
  const p = must(t.paint_product[product_id], 'Malingen');
  if (p.deleted_at) throw new CommandError('Malingen er skjult. Gjenopprett den først');
  return p;
}

function dropNeed(t: Tables, ws: Id, n: ShoppingNeed): void {
  t.shopping_need_project = t.shopping_need_project.filter((l) => l.need_id !== n.id);
  delete t.shopping_need[n.id];
  record(t, ws, { target_type: 'shopping_need', target_id: n.id, action: 'delete' });
}

export function createShoppingCommands(store: Store): ShoppingCommands {
  const tx = store.transaction.bind(store);

  return {
    async addToShoppingList(product_id, input = {}) {
      return tx((t, ws) => {
        livePaint(t, product_id);
        const ts = now();
        let n = needOf(t, product_id);
        if (n) {
          n.origin = 'manual';
          if (input.priority !== undefined) n.priority = priorityOf(input.priority);
          if (input.note !== undefined) n.note = input.note?.trim() || null;
          n.updated_at = ts;
          record(t, ws, { target_type: 'shopping_need', target_id: n.id, action: 'update' });
        } else {
          n = {
            id: newId(), workspace_id: ws, product_id, priority: priorityOf(input.priority ?? 'necessary'),
            note: input.note?.trim() || null, origin: 'manual', created_at: ts, updated_at: ts,
          };
          t.shopping_need[n.id] = n;
          record(t, ws, { target_type: 'shopping_need', target_id: n.id, action: 'create' });
        }
        for (const project_id of new Set(input.project_ids ?? [])) {
          const p = must(t.project[project_id], 'Prosjektet');
          if (p.deleted_at) throw new CommandError('Prosjektet er slettet');
          if (!t.shopping_need_project.some((l) => l.need_id === n.id && l.project_id === project_id)) {
            t.shopping_need_project.push({ need_id: n.id, project_id });
          }
        }
        return n.id;
      });
    },

    async setShoppingPriority(product_id, priority) {
      tx((t, ws) => {
        livePaint(t, product_id);
        const pr = priorityOf(priority);
        const n = needOf(t, product_id);
        if (n) {
          n.priority = pr;
          n.updated_at = now();
          record(t, ws, { target_type: 'shopping_need', target_id: n.id, action: 'update' });
          return;
        }
        if (!planNeeds(t).has(product_id) || ownershipOf(t, product_id) === 'owns') throw new CommandError('Malingen står ikke på handlelisten');
        const ts = now();
        const row: ShoppingNeed = { id: newId(), workspace_id: ws, product_id, priority: pr, note: null, origin: 'plan', created_at: ts, updated_at: ts };
        t.shopping_need[row.id] = row;
        record(t, ws, { target_type: 'shopping_need', target_id: row.id, action: 'create' });
      });
    },

    async removeFromShoppingList(product_id) {
      tx((t, ws) => {
        const n = needOf(t, product_id);
        if (!n) return;
        dropNeed(t, ws, n);
      });
    },

    async markPurchased(product_ids) {
      tx((t, ws) => {
        for (const id of new Set(product_ids)) {
          livePaint(t, id);
          setOwn(t, ws, id, 'owns', 'purchase');
          record(t, ws, { target_type: 'inventory_entry', target_id: id, action: 'update' });
          const n = needOf(t, id);
          if (n) dropNeed(t, ws, n);
        }
      });
    },
  };
}
