import React from 'react';
import './turnosCard.css';
// import { ReactComponent as TurnoIcon } from '../../assets/icons/turno-icon.svg';
import { ReactComponent as TurnoCancelIcon } from '../../assets/icons/circle-x.svg';
import { ReactComponent as TurnoDoneIcon } from '../../assets/icons/check.svg';

const TurnosCard = ({ id, nombreTurno, fechaTurno, onCancelTurno }) => {
  const formatDate = (isoString) => {
    const date = new Date(isoString);
    const day = date.getUTCDate().toString().padStart(2, '0');
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const year = date.getUTCFullYear();
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    return `${day}/${month}/${year} - ${hours}:${minutes}`;
  };

  const formattedDate = formatDate(fechaTurno);
  const showCancelButton = new Date(fechaTurno) > new Date();

  return (
    <div className='turnos-card-ctn'>
      {/* <div className="turno-icon">
        <TurnoIcon className='icon' />
      </div> */}
      <div className="turno-name">
        <b>{nombreTurno ?? "Nombre no disponible"}</b>
      </div>
      <div className="turno-date">
        <p>{formattedDate}</p>
      </div>
      <div className="turno-cancel">
        {showCancelButton ? (
          <button 
            className="cancel-button" 
            onClick={() => onCancelTurno(id)}
          >
            <TurnoCancelIcon className='icon' />
          </button>
        ) : (
          <span className="clase-realizada">
            <TurnoDoneIcon className='icon' />
          </span>
        )}
      </div>
    </div>
  );
};

export default TurnosCard;