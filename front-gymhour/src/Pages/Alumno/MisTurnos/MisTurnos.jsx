import React, { useState, useEffect } from 'react';
import '../../../App.css';
import './misTurnos.css';
import SidebarMenu from '../../../Components/SidebarMenu/SidebarMenu';
import SecondaryButton from '../../../Components/utils/SecondaryButton/SecondaryButton';
import TurnosCard from '../../../Components/TurnosCard/TurnosCard';
import { ReactComponent as AddCircleIcon } from '../../../assets/icons/add-circle.svg';
import apiService from '../../../services/apiService';
import LoaderFullScreen from '../../../Components/utils/LoaderFullScreen/LoaderFullScreen';
import ConfirmationPopup from '../../../Components/utils/ConfirmationPopUp/ConfirmationPopUp';
// ToastContainer
import { toast } from 'react-toastify';

const MisTurnos = () => {
    const [turnos, setTurnos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isPopupOpen, setIsPopupOpen] = useState(false);
    const [turnoToCancel, setTurnoToCancel] = useState(null);

    useEffect(() => {
        setLoading(true);
        const fetchData = async () => {
            const usuarioId = localStorage.getItem("usuarioId");
            try {
                const turnosData = await apiService.getTurnosUsuario(usuarioId); 
                // console.log("Turnos", turnosData);
                setTurnos(turnosData);
                setLoading(false);
            } catch (err) {
                toast.error("Error al cargar los turnos. Intente nuevamente.");
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    // Obtener la fecha actual
    const today = new Date();

    // Filtrar los turnos para obtener los próximos turnos
    const proximoTurnos = turnos.filter((turno) => {
        const turnoFecha = new Date(turno.fecha);
        return turnoFecha > today && turno.estado !== 'CANCELADO';
    });

    // Obtener el historial de turnos (todos menos los próximos)
    const historialTurnos = turnos.filter((turno) => {
        const turnoFecha = new Date(turno.fecha);
        return turnoFecha <= today;
    });

    // Función que abre el popup y guarda el turno seleccionado
    const handleOpenCancelPopup = (id) => {
        setTurnoToCancel(id);
        setIsPopupOpen(true);
    };

    // Función que se ejecuta al confirmar la cancelación
    const handleConfirmCancellation = async () => {
        // Cerramos el popup y mostramos el loader
        setIsPopupOpen(false);
        setLoading(true);
        try {
            await apiService.deleteTurno(turnoToCancel);
            setTurnos(prevTurnos =>
                prevTurnos.filter(turno => turno.id_turno !== turnoToCancel)
            );
            toast.success("Turno cancelado exitosamente.");
            setTurnoToCancel(null);
            setLoading(false);
        } catch (error) {
            console.error("Error al cancelar turno:", error);
            toast.error("Error al cancelar turno. Intente nuevamente.");
            setTurnoToCancel(null);
            setLoading(false);
        }
    };

    // Cierra el popup sin cancelar
    const handleClosePopup = () => {
        setIsPopupOpen(false);
        setTurnoToCancel(null);
    };

    return (
        <div className='page-layout'>
            {loading && <LoaderFullScreen />}
            <SidebarMenu isAdmin={false} />
            <div className='content-layout mis-turnos-ctn'>
                <div className="proximos-turnos-ctn">
                    <div className="proximo-turno-title">
                        <h2> Próximos turnos </h2>
                        <SecondaryButton linkTo="/alumno/agendar-turno" text="Agendar nuevo" icon={AddCircleIcon} />
                    </div>
                    <div className="proximo-turno-turnos">
                        {proximoTurnos.length > 0 ? (
                            proximoTurnos.map((turno) => (
                                <TurnosCard
                                    key={turno.id_turno}
                                    id={turno.id_turno}
                                    nombreTurno={turno.HorarioClase.Clase.nombre}
                                    fechaTurno={turno.fecha}
                                    horaTurno={turno.hora}
                                    onCancelTurno={() => handleOpenCancelPopup(turno.id_turno)}
                                />
                            ))
                        ) : (
                            <p>No tienes próximos turnos.</p>
                        )}
                    </div>
                </div>
                <div className="historial-turnos-ctn">
                    <div className="historial-turno-title">
                        <h2> Historial </h2>
                    </div>
                    <div className="proximo-turno-turnos">
                        {historialTurnos.length > 0 ? (
                            historialTurnos.slice(0, 10).map((turno) => (
                                <TurnosCard
                                    key={turno.id_turno}
                                    id={turno.id_turno}
                                    nombreTurno={turno.HorarioClase.Clase.nombre}
                                    fechaTurno={turno.fecha}
                                    horaTurno={turno.hora}
                                    onCancelTurno={() => handleOpenCancelPopup(turno.id_turno)}
                                />
                            ))
                        ) : (
                            <p>No tienes historial de turnos.</p>
                        )}
                    </div>
                </div>
            </div>
            <ConfirmationPopup
                isOpen={isPopupOpen}
                onClose={handleClosePopup}
                onConfirm={handleConfirmCancellation}
                message="¿Estás seguro de que deseas cancelar este turno?"
            />
            {/* <ToastContainer theme="dark" /> */}
        </div>
    );
};

export default MisTurnos;
