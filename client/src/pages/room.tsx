import { useParams } from "react-router";

const Room = () => {
  const { id } = useParams();

  return <div>{id}</div>;
};

export default Room;
