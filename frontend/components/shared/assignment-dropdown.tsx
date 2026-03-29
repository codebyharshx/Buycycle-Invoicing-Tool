"use client";

import * as React from "react";
import { Check, ChevronsUpDown, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { agentsApi, type Agent } from "@/lib/api";

interface Assignee {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
}

interface AssignmentDropdownProps {
  entityType?: string;
  currentAssignee: Assignee | null;
  onAssignmentChange: (assignee: Assignee | null) => Promise<void>;
  className?: string;
}

export function AssignmentDropdown({
  entityType,
  currentAssignee,
  onAssignmentChange,
  className
}: AssignmentDropdownProps) {
  const [open, setOpen] = React.useState(false);
  const [agents, setAgents] = React.useState<Agent[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [isAssigning, setIsAssigning] = React.useState(false);

  React.useEffect(() => {
    async function fetchAgents() {
      try {
        const result = await agentsApi.list();
        setAgents(result.data);
      } catch (error) {
        console.error("Failed to fetch agents:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchAgents();
  }, []);

  const handleSelect = async (agent: Agent | null) => {
    setIsAssigning(true);
    try {
      const assignee = agent
        ? { id: agent.id, firstName: agent.firstName, lastName: agent.lastName, email: agent.email }
        : null;
      await onAssignmentChange(assignee);
      setOpen(false);
    } catch (error) {
      console.error("Failed to assign:", error);
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={isAssigning}
          className={cn("w-full justify-between h-8 text-xs", className)}
        >
          {currentAssignee ? (
            <span className="flex items-center gap-2">
              <User className="h-3 w-3" />
              {currentAssignee.firstName} {currentAssignee.lastName}
            </span>
          ) : (
            <span className="text-muted-foreground">Unassigned</span>
          )}
          <ChevronsUpDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput placeholder="Search agents..." />
          <CommandList>
            <CommandEmpty>{loading ? "Loading..." : "No agents found."}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="unassign"
                onSelect={() => handleSelect(null)}
              >
                <Check className={cn("mr-2 h-4 w-4", !currentAssignee ? "opacity-100" : "opacity-0")} />
                Unassigned
              </CommandItem>
              {agents.map((agent) => (
                <CommandItem
                  key={agent.id}
                  value={`${agent.firstName} ${agent.lastName}`}
                  onSelect={() => handleSelect(agent)}
                >
                  <Check
                    className={cn("mr-2 h-4 w-4", currentAssignee?.id === agent.id ? "opacity-100" : "opacity-0")}
                  />
                  {agent.firstName} {agent.lastName}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
