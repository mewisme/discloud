"use client"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@discloud/ui/components/input-group"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { type ComponentProps, useState } from "react"

export function PasswordInput(
  props: Omit<ComponentProps<typeof InputGroupInput>, "type">,
) {
  const [visible, setVisible] = useState(false)

  return (
    <InputGroup>
      <InputGroupInput
        type={visible ? "text" : "password"}
        {...props}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          type="button"
          size="icon-xs"
          disabled={props.disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}