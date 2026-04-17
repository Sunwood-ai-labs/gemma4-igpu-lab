import { LlamaSpeedLab } from "@/components/llama-speed-lab";
import { getDefaultLabConfig } from "@/lib/llama-server";

export default function HomePage() {
  return <LlamaSpeedLab initialConfig={getDefaultLabConfig()} />;
}
