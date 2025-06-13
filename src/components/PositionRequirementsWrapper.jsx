// src/components/PositionRequirementsWrapper.jsx
import { useParams } from "react-router-dom";
import PositionRequirements from "./PositionRequirements";

export default function PositionRequirementsWrapper() {
  const { day } = useParams();
  return <PositionRequirements day={day} />;
}

